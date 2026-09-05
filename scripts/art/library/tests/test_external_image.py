import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from PIL import Image
from library.common import sha
from library.store import Store
from library.external_image import import_external_image
from library.recipe import approved_parent, prepare_graph, import_manifest
from library.review import decide, checked_output, require_approval
from library.cli import main
from library.worker import Worker


class ExternalImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store.initialize(self.root/'output/jobs', self.root/'game', self.root/'input', self.root/'output')
        Image.new('RGB', (16, 24), 'red').save(self.root/'source.png')
        (self.root/'provenance.md').write_text('GPT Image 2 source and reviewed prompt', encoding='utf8')
        self.document = dict(version=1, scope='general', source_type='external-image', provider='gpt-image-2',
            id='sakura-library-v2', character='sakura', scene='library', target_root=str(self.root/'game'),
            source=dict(path='source.png', sha256=sha(self.root/'source.png')),
            provenance=dict(path='provenance.md', sha256=sha(self.root/'provenance.md')),
            prompt='Fully clothed adult Sakura reading in a library', angle='profile', gaze='book', expression='happy', outfit='cream cardigan')
        self.path = self.root/'external.json'
        self.write()

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def write(self): self.path.write_text(json.dumps(self.document), encoding='utf8')
    def register(self): return import_external_image(self.store, self.path)

    def test_receipt_is_unapproved_image_without_generation_attempt(self):
        original = (self.root/'source.png').read_bytes()
        with patch('library.comfy.Comfy.request', side_effect=AssertionError('No Comfy calls')):
            self.register()
        job = self.store.job(self.document['id'])
        self.assertEqual((job['state'], job['kind'], job['attempt'], job['prompt_id']), ('generated', 'image', 0, None))
        self.assertEqual(self.store.rows('SELECT * FROM attempts'), [])
        self.assertEqual(self.store.rows('SELECT * FROM reviews'), [])
        self.assertEqual(Path(job['output']).read_bytes(), original)
        self.assertEqual((self.root/'source.png').read_bytes(), original)
        recipe = self.store.recipe(job['recipe_hash'])
        self.assertEqual(recipe['source_type'], 'external-image')
        self.assertEqual(recipe['provider'], 'gpt-image-2')
        self.assertNotIn('workflow', recipe)
        self.assertIsNone(json.loads(job['spec'])['job']['seed'])
        with self.assertRaises(ValueError): approved_parent(self.store, job)
        with self.assertRaises(ValueError): require_approval(self.store, job)
        with self.assertRaisesRegex(ValueError, 'External'):
            prepare_graph(self.store, job, {})
        with contextlib.redirect_stdout(io.StringIO()):
            main(['--root', str(self.store.root), 'review', job['id'], 'approved', '--sha256', job['output_hash'], '--reason', 'Full image reviewed'])
        approved_parent(self.store, self.store.job(job['id']))

    def test_cli_import_and_same_bytes_are_idempotent_and_preserve_review(self):
        with contextlib.redirect_stdout(io.StringIO()):
            main(['--root', str(self.store.root), 'import-external-image', str(self.path)])
        decide(self.store, self.document['id'], 'approved', 'Reviewed')
        self.register()
        self.assertEqual(len(self.store.rows('SELECT * FROM jobs')), 1)
        self.assertEqual(self.store.job(self.document['id'])['state'], 'approved')
        self.assertEqual(len(self.store.rows('SELECT * FROM reviews')), 1)

    def test_hash_and_id_collisions_rejected(self):
        self.register()
        Image.new('RGB', (16, 24), 'blue').save(self.root/'source.png')
        with self.assertRaises(ValueError): self.register()
        self.document['source']['sha256'] = sha(self.root/'source.png'); self.write()
        with self.assertRaises(ValueError): self.register()
        self.assertEqual(len(self.store.rows('SELECT * FROM jobs')), 1)

    def test_source_provenance_and_result_changes_invalidate_review_and_parent(self):
        self.register(); job = self.store.job(self.document['id'])
        decide(self.store, job['id'], 'approved', 'Reviewed')
        for path in [self.root/'source.png', self.root/'provenance.md', Path(job['output']), Path(job['output']).parent/'provenance', Path(job['output']).parent/'receipt.json']:
            original = path.read_bytes(); path.write_bytes(original + b'changed')
            with self.assertRaises(ValueError): checked_output(self.store, job)
            with self.assertRaises(ValueError): approved_parent(self.store, self.store.job(job['id']))
            path.write_bytes(original)
        decide(self.store, job['id'], 'rejected', 'Review reversed')
        with self.assertRaises(ValueError): approved_parent(self.store, self.store.job(job['id']))

    def test_invalid_metadata_and_target_do_not_register(self):
        for key, value in [('provider', 'other'), ('scope', 'other'), ('source_type', 'comfy'), ('id', '../escape'), ('character', '../escape'), ('scene', ''), ('target_root', str(self.root/'other')), ('prompt', '')]:
            old = self.document[key]; self.document[key] = value; self.write()
            with self.assertRaises(ValueError): self.register()
            self.document[key] = old
        self.assertEqual(self.store.rows('SELECT * FROM jobs'), [])

    def test_same_id_different_scene_and_missing_provenance_rejected(self):
        self.register()
        self.document['scene'] = 'different'; self.write()
        with self.assertRaises(ValueError): self.register()
        del self.document['provenance']; self.write()
        with self.assertRaises(ValueError): self.register()
        self.assertEqual(len(self.store.rows('SELECT * FROM jobs')), 1)

    def test_decode_failure_and_mislabeled_non_png_rejected(self):
        for content in [b'broken', None]:
            if content is not None: (self.root/'source.png').write_bytes(content)
            else: Image.new('RGB', (16,24)).save(self.root/'source.png', format='JPEG')
            self.document['source']['sha256'] = sha(self.root/'source.png'); self.write()
            with self.assertRaises((ValueError, OSError)): self.register()
        self.assertEqual(self.store.rows('SELECT * FROM jobs'), [])

    def test_change_during_copy_never_registers(self):
        import shutil
        real_copy = shutil.copyfileobj
        def changed(src, dst):
            real_copy(src, dst)
            if Path(src.name).name == 'source.png':
                with (self.root/'source.png').open('ab') as stream: stream.write(b'changed')
        with patch('library.external_image.shutil.copyfileobj', side_effect=changed):
            with self.assertRaises(ValueError): self.register()
        self.assertEqual(self.store.rows('SELECT * FROM jobs'), [])

    def test_existing_video_import_accepts_only_reviewed_parent_and_detects_later_change(self):
        self.register(); parent = self.store.job(self.document['id'])
        graph = {'text': {'class_type': 'Text', 'inputs': {'text': ''}}, 'noise': {'class_type': 'Noise', 'inputs': {'seed': 0}}, 'load': {'class_type': 'LoadImage', 'inputs': {'image': ''}}, 'save': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': ''}}}
        graph_path = self.root/'graph.json'; graph_path.write_text(json.dumps(graph))
        recipe = dict(version=1, queue_approved=True, scope='general', kind='video', workflow=dict(path='graph.json', sha256=sha(graph_path)), models=[], allowed_nodes=['Text', 'Noise', 'LoadImage', 'SaveImage'], bindings=dict(prompt=['text','text'], seed=['noise','seed'], output_prefix=['save','filename_prefix'], inputs=dict(parent=['load','image'])), output_node='save', media=dict(width=16,height=24))
        (self.root/'recipe.json').write_text(json.dumps(recipe))
        job = dict(id='video-child', character='sakura', scene='library', parent_job=parent['id'], seed=1, prompt='gentle motion', angle='profile', gaze='book', expression='happy', outfit='cardigan', inputs=dict(parent=dict(path=parent['output'],sha256=parent['output_hash'])))
        manifest = dict(scope='general', target_root=str(self.root/'game'), recipe='recipe.json', jobs=[job])
        manifest_path = self.root/'video.json'; manifest_path.write_text(json.dumps(manifest))
        with self.assertRaises(ValueError): import_manifest(self.store,manifest_path)
        decide(self.store,parent['id'],'approved','Reviewed')
        self.assertEqual(import_manifest(self.store,manifest_path), ['video-child'])
        (self.root/'provenance.md').write_text('changed')
        with self.assertRaises(ValueError): import_manifest(self.store,manifest_path)
        with self.assertRaises(ValueError): prepare_graph(self.store,self.store.job('video-child'),dict(prefix='test'))

    def test_worker_never_submits_external_source_even_if_forced_pending(self):
        self.register(); client = Mock()
        worker = Worker(self.store, client, lock_path=self.root/'fake.lock')
        self.assertEqual(self.store.rows("SELECT id FROM jobs WHERE state='pending'"), [])
        self.store.state(self.document['id'], 'pending')
        self.assertFalse(worker.submit_one(self.store.job(self.document['id'])))
        self.assertEqual(self.store.rows('SELECT * FROM attempts'), [])
        client.submit.assert_not_called()
        self.assertEqual(client.mock_calls, [])

    def test_existing_unrecorded_staging_is_not_overwritten(self):
        self.register(); job = self.store.job(self.document['id']); output = Path(job['output']); original = output.read_bytes()
        with self.store.db: self.store.db.execute('DELETE FROM jobs WHERE id=?',(job['id'],))
        with self.assertRaises(ValueError): self.register()
        self.assertEqual(output.read_bytes(), original)

    def test_wrong_review_hash_does_not_approve(self):
        self.register()
        with self.assertRaises(ValueError):
            main(['--root', str(self.store.root), 'review', self.document['id'], 'approved', '--sha256', '0'*64, '--reason', 'Reviewed'])
        self.assertEqual(self.store.rows('SELECT * FROM reviews'), [])


if __name__ == '__main__': unittest.main()

