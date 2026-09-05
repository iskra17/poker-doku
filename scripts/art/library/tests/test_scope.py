import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from PIL import Image
from library.common import ALLOWED_SCOPES, sha
from library.store import Store
from library.external_image import import_external_image
from library.recipe import import_manifest
from library.review import decide


class ScopeTests(unittest.TestCase):
    """Bonus CG line uses scope 'bonus' on the same ledger; nothing else may pass and scopes must agree."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store.initialize(self.root/'output/jobs', self.root/'game', self.root/'input', self.root/'output')
        Image.new('RGB', (16, 24), 'blue').save(self.root/'source.png')
        (self.root/'provenance.md').write_text('GPT Image 2 bonus source and reviewed prompt', encoding='utf8')
        graph = {'text': {'class_type': 'Text', 'inputs': {'text': ''}}, 'noise': {'class_type': 'Noise', 'inputs': {'seed': 0}},
                 'load': {'class_type': 'LoadImage', 'inputs': {'image': ''}}, 'save': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': ''}}}
        (self.root/'graph.json').write_text(json.dumps(graph))
        self.allowed_nodes = ['Text', 'Noise', 'LoadImage', 'SaveImage']

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def document(self, scope):
        return dict(version=1, scope=scope, source_type='external-image', provider='gpt-image-2',
            id='sakura-beach-bonus', character='sakura', scene='beach', target_root=str(self.root/'game'),
            source=dict(path='source.png', sha256=sha(self.root/'source.png')),
            provenance=dict(path='provenance.md', sha256=sha(self.root/'provenance.md')),
            prompt='Adult Sakura at a summer beach in standard swimwear', angle='low three-quarter', gaze='beach ball', expression='laughing', outfit='pastel pink frilled bikini with white pareo')

    def register(self, scope):
        path = self.root/f'external-{scope}.json'
        path.write_text(json.dumps(self.document(scope)), encoding='utf8')
        return import_external_image(self.store, path)

    def recipe(self, scope):
        return dict(version=1, queue_approved=True, scope=scope, kind='video', workflow=dict(path='graph.json', sha256=sha(self.root/'graph.json')), models=[],
            allowed_nodes=self.allowed_nodes, bindings=dict(prompt=['text','text'], seed=['noise','seed'], output_prefix=['save','filename_prefix'], inputs=dict(parent=['load','image'])),
            output_node='save', media=dict(width=16, height=24))

    def manifest(self, scope, parent, recipe_name):
        job = dict(id='sakura-beach-bonus-video', character='sakura', scene='beach', parent_job=parent['id'], seed=1, prompt='gentle ambient motion',
                   angle='low three-quarter', gaze='beach ball', expression='laughing', outfit='pastel pink frilled bikini', inputs=dict(parent=dict(path=parent['output'], sha256=parent['output_hash'])))
        return dict(scope=scope, target_root=str(self.root/'game'), recipe=recipe_name, jobs=[job])

    def test_allowed_scopes_are_general_and_bonus_only(self):
        self.assertEqual(ALLOWED_SCOPES, ('general', 'bonus'))

    def test_bonus_external_receipt_records_bonus_scope(self):
        self.register('bonus')
        job = self.store.job('sakura-beach-bonus')
        self.assertEqual(job['state'], 'generated')
        self.assertEqual(self.store.recipe(job['recipe_hash'])['scope'], 'bonus')

    def test_unknown_scope_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'general|bonus'):
            self.register('nsfw')
        self.assertEqual(self.store.rows('SELECT * FROM jobs'), [])

    def test_manifest_scope_must_match_recipe_scope(self):
        self.register('bonus')
        parent = self.store.job('sakura-beach-bonus')
        decide(self.store, parent['id'], 'approved', 'Full-resolution bonus review')
        (self.root/'recipe-general.json').write_text(json.dumps(self.recipe('general')))
        (self.root/'recipe-bonus.json').write_text(json.dumps(self.recipe('bonus')))
        mismatch = self.root/'mismatch.json'
        mismatch.write_text(json.dumps(self.manifest('bonus', parent, 'recipe-general.json')))
        with self.assertRaisesRegex(ValueError, 'scope'):
            import_manifest(self.store, mismatch)
        self.assertEqual(self.store.rows("SELECT id FROM jobs WHERE kind='video'"), [])
        matching = self.root/'matching.json'
        matching.write_text(json.dumps(self.manifest('bonus', parent, 'recipe-bonus.json')))
        self.assertEqual(import_manifest(self.store, matching), ['sakura-beach-bonus-video'])
        unknown = self.root/'unknown.json'
        unknown.write_text(json.dumps(self.manifest('adult', parent, 'recipe-bonus.json')))
        with self.assertRaises(ValueError):
            import_manifest(self.store, unknown)


if __name__ == '__main__':
    unittest.main()
