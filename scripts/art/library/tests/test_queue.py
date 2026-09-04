import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from PIL import Image
from library.common import sha,GpuLock
from library.store import Store
from library.comfy import Comfy
from library.recipe import import_manifest
from library.worker import Worker
from library.media import inspect_media
from library.common import fingerprint
from library.review import decide,export,sheet

HERE=Path(__file__).parent
class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        self.process=subprocess.Popen([sys.executable,'-B',str(HERE/'fake_comfy.py'),str(self.root)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        self.wait(lambda:(self.root/'ready.json').exists())
        self.endpoint='http://127.0.0.1:'+str(json.loads((self.root/'ready.json').read_text())['port'])
        self.client=Comfy(self.endpoint); self.lock=self.root/'gpu.lock'
        self.store=Store.initialize(self.root/'output'/'jobs',self.root/'game',self.root/'input',self.root/'output')
        (self.root/'game/scripts/art').mkdir(parents=True); (self.root/'game/scripts/art/convert.mjs').write_text('// fixture')
        Image.new('RGB',(16,16),'red').save(self.root/'ref.png'); (self.root/'model.bin').write_bytes(b'model')
        graph={'loader':{'class_type':'LoadImage','inputs':{'image':''}},'text':{'class_type':'CLIPTextEncode','inputs':{'text':''}},'noise':{'class_type':'KSampler','inputs':{'seed':1}},'save':{'class_type':'SaveImage','inputs':{'filename_prefix':''}}}
        self.write('graph.json',graph)
        recipe={'version':1,'queue_approved':True,'scope':'general','kind':'image','workflow':{'path':'graph.json','sha256':sha(self.root/'graph.json')},'models':[{'path':'model.bin','sha256':sha(self.root/'model.bin')}],'allowed_nodes':[n['class_type'] for n in graph.values()],'bindings':{'prompt':['text','text'],'seed':['noise','seed'],'output_prefix':['save','filename_prefix'],'inputs':{'reference':['loader','image']}},'output_node':'save','media':{'width':16,'height':16}}
        self.write('recipe.json',recipe)
        self.manifest={'scope':'general','target_root':str(self.root/'game'),'recipe':'recipe.json','jobs':[self.job('one')]}
        self.write('manifest.json',self.manifest)
    def tearDown(self):
        self.store.close(); self.process.terminate(); self.process.communicate(timeout=5); self.temp.cleanup()
    def wait(self,predicate):
        until=time.monotonic()+8
        while not predicate():
            if time.monotonic()>until: self.fail('fixture timeout')
            time.sleep(.02)
    def write(self,name,value): (self.root/name).write_text(json.dumps(value),encoding='utf8')
    def job(self,name): return {'id':name,'character':'sakura','scene':name,'seed':1,'prompt':'fully clothed adult woman looking at garden','angle':'profile','gaze':'garden','expression':'calm','outfit':'cream cardigan','inputs':{'reference':{'path':'ref.png','sha256':sha(self.root/'ref.png')}}}
    def load(self,second=False):
        if second: self.manifest['jobs'].append(self.job('two')); self.write('manifest.json',self.manifest)
        return import_manifest(self.store,self.root/'manifest.json')
    def worker(self,**kwargs): return Worker(self.store,self.client,lock_path=self.lock,poll=.02,disk_free=lambda:10**12,**kwargs)
    def control(self,**kwargs): return self.client.request('/test/control',kwargs)
    def count(self): return self.client.request('/test/state')['count']
    def child(self,stage='none'):
        return subprocess.Popen([sys.executable,'-B',str(HERE/'worker_child.py'),str(self.store.root),self.endpoint,str(self.lock),stage],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    def kill_at(self,stage):
        child=self.child(stage); _,err=child.communicate(timeout=10); self.assertEqual(child.returncode,77,err)
    def test_import_immutable_and_generate_once(self):
        self.load(); self.load(); self.worker().run(); self.worker().run()
        self.assertEqual(self.count(),1); self.assertEqual(self.store.job('one')['state'],'generated')
        self.manifest['jobs'][0]['seed']=2; self.write('manifest.json',self.manifest)
        with self.assertRaises(ValueError): self.load()
    def test_crash_before_intent_is_safe_to_submit(self):
        self.load(); self.kill_at('before_intent_commit'); self.assertEqual(self.count(),0)
        self.worker().run(); self.assertEqual(self.count(),1)
    def test_crash_before_post_unknown_and_other_job_continues(self):
        self.load(True); self.kill_at('before_submit'); self.worker().run()
        self.assertEqual(self.store.job('one')['state'],'unknown'); self.assertEqual(self.store.job('two')['state'],'generated'); self.assertEqual(self.count(),1)
        intent=self.store.rows("SELECT intent FROM attempts WHERE job_id='one'")[0]['intent']
        self.worker().reconcile(mark_failed=intent,reason='Fixture proves POST was not sent')
        self.worker().reconcile(retry='one',reason='Explicit retry'); self.worker().run()
        self.assertEqual(self.store.job('one')['attempt'],2); self.assertEqual(self.count(),2)
    def test_crash_after_post_recovers_history(self):
        self.load(); self.kill_at('after_submit_response'); self.worker().run(); self.assertEqual(self.count(),1)
        self.assertEqual(self.store.job('one')['state'],'generated')
    def test_crash_before_result_commit_recovers_png_without_history(self):
        self.load(); self.kill_at('before_result_commit'); self.control(clear_history=True); self.worker().run()
        self.assertEqual(self.count(),1); self.assertEqual(self.store.job('one')['state'],'generated')
    def test_response_loss_recovers_without_resubmit(self):
        self.load(); self.control(mode='drop'); self.worker().run(); self.worker().run()
        self.assertEqual(self.count(),1); self.assertEqual(self.store.job('one')['state'],'generated')
    def test_corrupt_result_failed_and_next_continues(self):
        self.load(True); self.control(mode='corrupt'); self.worker().run(limit=2)
        self.assertEqual(self.count(),2); self.assertEqual(self.store.job('one')['state'],'failed')
    def test_duplicate_history_is_unknown(self):
        self.load(); self.control(mode='duplicate'); self.worker().run(); self.worker().run()
        self.assertEqual(self.count(),1); self.assertEqual(self.store.job('one')['state'],'unknown')
    def test_external_queue_and_pause(self):
        self.load(); self.control(foreign=True); self.worker().run(); self.assertEqual(self.count(),0)
        self.control(clear_queue=True); self.store.pause(True); self.worker().run(); self.assertEqual(self.count(),0)
        self.store.pause(False); self.worker().run(); self.assertEqual(self.count(),1)
    def test_pause_finishes_current_without_next_and_restart(self):
        self.load(True); self.control(mode='hold'); child=self.child()
        try:
            self.wait(lambda:self.count()==1); self.store.pause(True); self.control(finish=True,mode='complete')
            _,err=child.communicate(timeout=10); self.assertEqual(child.returncode,0,err)
            self.assertEqual(self.count(),1); self.assertEqual(self.store.job('one')['state'],'generated')
            self.assertEqual(self.store.job('two')['state'],'pending'); self.store.pause(False); self.worker().run(); self.assertEqual(self.count(),2)
        finally:
            if child.poll() is None: child.terminate(); child.communicate(timeout=5)
    def test_two_processes_different_roots_share_lock(self):
        ready=self.root/'locked'; child=subprocess.Popen([sys.executable,'-B',str(HERE/'worker_child.py'),'lock',str(self.lock),str(ready)])
        try:
            self.wait(ready.exists)
            second=Store.initialize(self.root/'output'/'other',self.root/'game',self.root/'input',self.root/'output')
            try:
                with self.assertRaises(RuntimeError): Worker(second,Comfy(self.endpoint.replace('127.0.0.1','localhost')),lock_path=self.lock).run()
            finally: second.close()
        finally: child.terminate(); child.wait(timeout=5)
        with GpuLock(self.lock): pass
    def test_model_workflow_reference_tamper(self):
        self.load(); (self.root/'model.bin').write_bytes(b'changed'); self.worker().run()
        self.assertEqual(self.count(),0); self.assertIn('hash mismatch',self.store.job('one')['error'])
    def test_workflow_tamper_rejected_before_submit(self):
        self.load(); (self.root/'graph.json').write_text('{}'); self.worker().run()
        self.assertEqual(self.count(),0); self.assertEqual(self.store.job('one')['state'],'failed')
    def test_reference_tamper_rejected_before_submit(self):
        self.load(); Image.new('RGB',(16,16),'green').save(self.root/'ref.png'); self.worker().run()
        self.assertEqual(self.count(),0); self.assertEqual(self.store.job('one')['state'],'failed')
    def test_history_path_escape_rejected(self):
        self.load(); self.kill_at('after_submit_response'); self.control(escape_output=True); self.worker().run()
        self.assertEqual(self.store.job('one')['state'],'failed'); self.assertEqual(self.count(),1)
    def test_lost_history_wrong_png_metadata_remains_unknown(self):
        self.load(); self.kill_at('after_submit_response'); self.control(clear_history=True)
        path=next((self.store.root/'results').glob('*.png')); Image.new('RGB',(16,16),'blue').save(path)
        self.worker().run(); self.assertEqual(self.store.job('one')['state'],'unknown'); self.assertEqual(self.count(),1)
    def test_output_prefix_collision_prevents_submission(self):
        self.load(); job=self.store.job('one'); prefix=f"one--fixed--a1--r{job['recipe_hash']}"
        directory=self.store.root/'results'; directory.mkdir(); (directory/(prefix+'_00001_.png')).write_bytes(b'existing')
        with patch('library.worker.uuid.uuid4') as fake:
            fake.return_value.hex='fixed'; self.worker().run()
        self.assertEqual(self.count(),0); self.assertIn('already exists',self.store.job('one')['error'])
    def test_execution_error_is_failed_not_unknown(self):
        self.load(); self.kill_at('after_submit_response'); self.control(execution_error=True); self.worker().run()
        self.assertEqual(self.store.job('one')['state'],'failed'); self.assertEqual(self.count(),1)
    def test_running_timeout_preserves_attempt(self):
        self.load(); self.control(mode='hold')
        with self.assertRaises(TimeoutError): self.worker().run(max_wait=.05)
        self.assertEqual(self.store.job('one')['state'],'submitted'); self.assertEqual(self.count(),1)
        self.control(finish=True); self.worker().run(); self.assertEqual(self.count(),1)
    def test_three_attempt_ceiling_requires_explicit_retry(self):
        self.load(); self.control(mode='corrupt')
        for number in (1,2,3):
            self.worker().run(); self.assertEqual(self.store.job('one')['attempt'],number)
            if number<3: self.worker().reconcile(retry='one',reason='Fixture retry')
        with self.assertRaises(ValueError): self.worker().reconcile(retry='one',reason='Fourth forbidden')
        self.assertEqual(self.count(),3)
    def test_video_decode_and_approved_parent_contract(self):
        self.load(); self.worker().run(); parent=self.store.job('one')
        recipe=json.loads((self.root/'recipe.json').read_text()); recipe['kind']='video'; recipe['media'].update(min_frames=2,min_duration=.2,max_duration=2)
        self.write('video-recipe.json',recipe); video=self.job('video'); video['parent_job']='one'; video['inputs']['reference']={'path':parent['output'],'sha256':parent['output_hash']}
        self.write('video-manifest.json',dict(self.manifest,recipe='video-recipe.json',jobs=[video]))
        with self.assertRaises(ValueError): import_manifest(self.store,self.root/'video-manifest.json')
        decide(self.store,'one','approved','Temporary image parent approved')
        import_manifest(self.store,self.root/'video-manifest.json'); self.assertEqual(self.store.job('video')['kind'],'video')
        path=self.root/'clip.mp4'; meta={'intent':'video-fixture','attempt':1,'recipe_hash':'hash','job_id':'video'}
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=blue:s=16x16:r=10:d=0.5','-c:v','libx264','-metadata','comment='+json.dumps({'poker_doku_art':meta}),str(path)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        self.assertEqual(inspect_media(path,'video',recipe['media'],meta)['frames'],5)
        with self.assertRaises(ValueError): inspect_media(path,'video',recipe['media'],dict(meta,intent='wrong'))
        path.write_bytes(path.read_bytes()[:64])
        with self.assertRaises(ValueError): inspect_media(path,'video',recipe['media'])
    def test_sheet_has_full_output_link_and_cli_requires_review_hash(self):
        self.load(); self.worker().run(); page=Path(sheet(self.store)).read_text(encoding='utf8')
        self.assertIn('Open full result',page)
        entry=HERE.parents[1]/'library-worker.py'
        result=subprocess.run([sys.executable,'-B',str(entry),'--root',str(self.store.root),'review','one','approved','--reason','fixture','--sha256','incorrect'],capture_output=True,text=True)
        self.assertEqual(result.returncode,1); self.assertIn('hash',result.stderr)
    def test_reference_decode_rejected_even_with_matching_hash(self):
        (self.root/'ref.png').write_bytes(b'broken'); self.manifest['jobs'][0]=self.job('one'); self.write('manifest.json',self.manifest)
        with self.assertRaises(OSError): self.load()
    def test_low_disk_no_submission(self):
        self.load(); worker=self.worker(); worker.disk_free=lambda:1; worker.run(); self.assertEqual(self.count(),0)
    def test_review_export_hash_binding_idempotence_and_paths(self):
        self.load(); self.worker().run(); target='public/assets/story/cg/sakura-one.webp'
        def convert(source,dest,mode,root): Image.open(source).resize((768,1152)).save(dest,'WEBP')
        def send(path=target,root=None): return export(self.store,'one',root or self.root/'game',path,convert=convert,lock_path=self.root/'export.lock')
        with self.assertRaises(ValueError): send()
        decide(self.store,'one','approved','Fixture visual review only')
        with self.assertRaises(ValueError): send('../escape.webp')
        with self.assertRaises(ValueError): send(root=self.root/'other-game')
        send(); send(); self.assertEqual(len(self.store.rows('SELECT * FROM exports')),1)
        collision=self.root/'game/public/assets/story/cg/collision.webp'; collision.write_bytes(b'existing')
        with self.assertRaises(ValueError): send('public/assets/story/cg/collision.webp')
        Path(self.store.job('one')['output']).write_bytes(b'tampered')
        with self.assertRaises(ValueError): send()
    def test_rejected_review_records_reason(self):
        self.load(); self.worker().run(); decide(self.store,'one','rejected','Hand anatomy wrong')
        self.assertEqual(self.store.job('one')['state'],'rejected'); self.assertEqual(self.store.rows('SELECT * FROM reviews')[0]['reason'],'Hand anatomy wrong')
    def test_export_crash_after_publish_recovers_receipt(self):
        self.load(); self.worker().run(); decide(self.store,'one','approved','Fixture only')
        def convert(source,dest,mode,root): Image.open(source).resize((768,1152)).save(dest,'WEBP')
        real_link=os.link
        def crash(source,target): real_link(source,target); raise RuntimeError('Simulated crash after atomic publish')
        def send(): return export(self.store,'one',self.root/'game','public/assets/story/cg/recovery.webp',convert=convert,lock_path=self.root/'export.lock')
        with patch('library.review.os.link',side_effect=crash):
            with self.assertRaises(RuntimeError): send()
        self.assertEqual(self.store.rows('SELECT state FROM exports')[0]['state'],'pending')
        send(); self.assertEqual(self.store.rows('SELECT state FROM exports')[0]['state'],'complete')
    def test_metadata_disabled_server_rejected_before_post(self):
        self.load()
        with patch.object(self.client,'stats',return_value={'system':{'argv':['--disable-metadata']}}):
            with self.assertRaises(ValueError): self.worker().run()
        self.assertEqual(self.count(),0)

if __name__=='__main__': unittest.main()
