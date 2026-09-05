import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from library.common import canonical,sha
from library.store import Store
from library.review import decide,export
from library.video_pair import export_video_pair,convert_pair,PAIR_SETTINGS

class VideoPairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture=tempfile.TemporaryDirectory(); cls.files=Path(cls.fixture.name)
        cls.source=cls.files/'source.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=blue:s=768x1152:r=24','-frames:v','107','-c:v','libx264','-preset','ultrafast',str(cls.source)],check=True)
        cls.encoded={ext:cls.files/('encoded.'+ext) for ext in ('mp4','webm')}
        convert_pair(cls.source,cls.encoded)
    @classmethod
    def tearDownClass(cls): cls.fixture.cleanup()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        self.store=Store.initialize(self.root/'output/jobs',self.root/'game',self.root/'input',self.root/'output')
        source=self.store.root/'source.mp4'; shutil.copyfile(self.source,source)
        recipe={'media':{'width':768,'height':1152,'min_frames':2}}
        with self.store.db:
            self.store.db.execute('INSERT INTO recipes VALUES(?,?)',('fixture',canonical(recipe)))
            self.store.db.execute('INSERT INTO jobs(id,spec_hash,spec,recipe_hash,kind,character,scene,seed,state,output,output_hash,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('video','fixture','{}','fixture','video','sakura','rain',1,'generated',str(source),sha(source),0))
        decide(self.store,'video','approved','Temporary synthetic video only')
    def tearDown(self): self.store.close(); self.temp.cleanup()
    def copy_convert(self,source,paths):
        for ext,path in paths.items(): shutil.copyfile(self.encoded[ext],path)
    def run_pair(self,**kwargs):
        return export_video_pair(self.store,'video',self.root/'game','public/assets/story/video/scene-fixture',convert=self.copy_convert,lock_path=self.root/'export.lock',**kwargs)
    def test_pair_exact_frames_formats_and_idempotent(self):
        pair=self.run_pair(); again=self.run_pair(); self.assertEqual(pair,again)
        self.assertEqual(pair['state'],'complete'); self.assertEqual(len(pair['parts']),2)
        for part in pair['parts'].values(): self.assertEqual(part['media']['frames'],106); self.assertLessEqual(part['media']['bytes'],2_500_000)
    def test_crash_after_first_publication_recovers_no_overwrite(self):
        def crash(stage):
            if stage=='after_publish_mp4': raise RuntimeError('process crash')
        with self.assertRaises(RuntimeError): self.run_pair(checkpoint=crash)
        target=self.root/'game/public/assets/story/video/scene-fixture.mp4'; before=sha(target)
        pair=self.run_pair(); self.assertEqual(sha(target),before); self.assertEqual(pair['state'],'complete')
        self.assertEqual(list(target.parent.glob('*.pending')),[])
    def test_partial_publication_rejected_review_blocks_resume(self):
        def crash(stage):
            if stage=='after_publish_mp4': raise RuntimeError('crash')
        with self.assertRaises(RuntimeError): self.run_pair(checkpoint=crash)
        decide(self.store,'video','rejected','Fixture second review rejects motion')
        with self.assertRaises(ValueError): self.run_pair()
        self.assertFalse((self.root/'game/public/assets/story/video/scene-fixture.webm').exists())
    def test_collision_and_wrong_root_and_escape(self):
        target=self.root/'game/public/assets/story/video/scene-fixture.webm'; target.parent.mkdir(parents=True); target.write_bytes(b'existing')
        with self.assertRaises(ValueError): self.run_pair()
        self.assertEqual(target.read_bytes(),b'existing')
        with self.assertRaises(ValueError): export_video_pair(self.store,'video',self.root/'other','public/assets/story/video/scene-fixture',lock_path=self.root/'export.lock')
        with self.assertRaises(ValueError): export_video_pair(self.store,'video',self.root/'game','../escape',lock_path=self.root/'export.lock')
    def test_published_byte_tamper_is_not_overwritten(self):
        self.run_pair(); target=self.root/'game/public/assets/story/video/scene-fixture.mp4'; target.write_bytes(b'tamper')
        with self.assertRaises(ValueError): self.run_pair()
        self.assertEqual(target.read_bytes(),b'tamper')
    def test_source_tamper_rejected(self):
        Path(self.store.job('video')['output']).write_bytes(b'bad')
        with self.assertRaises(ValueError): self.run_pair()
    def test_pair_reservation_blocks_single_export_and_other_artifact(self):
        def crash(stage):
            if stage=='after_pair_ready': raise RuntimeError('crash before publish')
        with self.assertRaises(RuntimeError): self.run_pair(checkpoint=crash)
        with self.assertRaises(ValueError):
            export(self.store,'video',self.root/'game','public/assets/story/video/scene-fixture.mp4',lock_path=self.root/'export.lock')
        with self.store.db:
            job=self.store.job('video')
            self.store.db.execute('INSERT INTO jobs(id,spec_hash,spec,recipe_hash,kind,character,scene,seed,state,output,output_hash,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('other','fixture','{}','fixture','video','sakura','rain',2,'generated',job['output'],job['output_hash'],1))
        decide(self.store,'other','approved','Fixture separate artifact')
        with self.assertRaises(ValueError): export_video_pair(self.store,'other',self.root/'game','public/assets/story/video/scene-fixture',lock_path=self.root/'export.lock')
    def test_partial_pair_staging_tamper_rejected(self):
        def crash(stage):
            if stage=='after_publish_mp4': raise RuntimeError('crash')
        with self.assertRaises(RuntimeError): self.run_pair(checkpoint=crash)
        row=self.store.rows('SELECT definition FROM video_pairs')[0]; part=json.loads(row['definition'])['parts']['webm']; Path(part['staged']).write_bytes(b'changed')
        with self.assertRaises(ValueError): self.run_pair()
        self.assertFalse((self.root/'game/public/assets/story/video/scene-fixture.webm').exists())
    def test_staging_symlink_cannot_delete_unrelated_file(self):
        def crash(stage):
            if stage=='after_pair_ready': raise RuntimeError('crash')
        with self.assertRaises(RuntimeError): self.run_pair(checkpoint=crash)
        part=json.loads(self.store.rows('SELECT definition FROM video_pairs')[0]['definition'])['parts']['webm']
        stage=Path(part['staged']); stage.unlink(); unrelated=self.store.root/'unrelated'; unrelated.write_bytes(b'keep me')
        try: stage.symlink_to(unrelated)
        except OSError: self.skipTest('Host cannot create test symlinks')
        with self.assertRaises(ValueError): self.run_pair()
        self.assertEqual(unrelated.read_bytes(),b'keep me')
    def test_wrong_frame_count_and_rejection_during_conversion(self):
        source=Path(self.store.job('video')['output']); shutil.copyfile(self.encoded['mp4'],source)
        with self.store.db: self.store.db.execute('UPDATE jobs SET output_hash=?',(sha(source),))
        decide(self.store,'video','approved','Fixture 106-frame source')
        with self.assertRaises(ValueError): self.run_pair()
        shutil.copyfile(self.source,source)
        with self.store.db: self.store.db.execute('UPDATE jobs SET output_hash=?',(sha(source),))
        decide(self.store,'video','approved','Fixture restored')
        def reject(source,paths):
            self.copy_convert(source,paths); decide(self.store,'video','rejected','Rejected during CPU conversion')
        with self.assertRaises(ValueError): export_video_pair(self.store,'video',self.root/'game','public/assets/story/video/scene-fixture',convert=reject,lock_path=self.root/'export.lock')
        self.assertEqual(list((self.root/'game').rglob('*.mp4')),[])
    def test_unapproved_and_size_limits(self):
        decide(self.store,'video','rejected','No approval')
        with self.assertRaises(ValueError): self.run_pair()
        decide(self.store,'video','approved','Fixture restored')
        with patch.dict(PAIR_SETTINGS,{'max_bytes':1}):
            with self.assertRaises(ValueError): self.run_pair()

if __name__=='__main__': unittest.main()
