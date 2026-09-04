import json
from pathlib import Path
import shutil
import sys
import time
import uuid
from .common import GPU_LOCK, GpuLock, atomic_json, canonical, confined
from .comfy import metadata, tuple_metadata, queue_items, Rejected
from .media import inspect_media
from .recipe import prepare_graph

class Worker:
    def __init__(self, store, client, *, lock_path=GPU_LOCK, poll=2, checkpoint=None, disk_free=None):
        self.store=store; self.client=client; self.lock_path=lock_path; self.poll=poll
        # Only Python tests inject these. CLI exposes no lock override or kill switch.
        self.checkpoint=checkpoint or (lambda stage:None)
        self.disk_free=disk_free or (lambda:shutil.disk_usage(store.root).free)

    def server_guard(self):
        system=self.client.stats().get('system',{}); argv=system.get('argv')
        if not isinstance(argv,list) or '--disable-metadata' in argv: raise ValueError('Comfy metadata must be enabled and inspectable')
        for flag,key in [('--input-directory','input_root'),('--output-directory','output_root')]:
            if flag not in argv or argv.index(flag)+1>=len(argv) or Path(argv[argv.index(flag)+1]).resolve()!=Path(self.store.config[key]):
                raise ValueError('Comfy input/output directory does not match the local ledger')

    def attempts(self):
        return self.store.rows("SELECT * FROM attempts WHERE state IN ('submitting','submitted','unknown') ORDER BY started")

    def paths_for(self, attempt):
        prefix=confined(self.store.config['output_root'],attempt['prefix'])
        confined(self.store.root,prefix)
        return prefix, list(prefix.parent.glob(prefix.name+'*')) if prefix.parent.exists() else []

    def register(self, attempt, path, prompt_id=None):
        store=self.store; job=store.job(attempt['job_id']); recipe=store.recipe(job['recipe_hash'])
        path=confined(store.root,path)
        prefix,_=self.paths_for(attempt)
        if path.parent!=prefix.parent or not path.name.startswith(prefix.name+'_'): raise ValueError('Result does not belong to deterministic intent prefix')
        info=inspect_media(path,job['kind'],recipe['media'],metadata(attempt))
        self.checkpoint('before_result_commit')
        with store.db:
            store.db.execute("UPDATE attempts SET state='generated',prompt_id=COALESCE(?,prompt_id),finished=?,error=NULL WHERE intent=?",(prompt_id,time.time(),attempt['intent']))
            store.db.execute("UPDATE jobs SET state='generated',prompt_id=COALESCE(?,prompt_id),output=?,output_hash=?,media=?,error=NULL WHERE id=?",(prompt_id,str(path),info['sha256'],canonical(info),job['id']))

    def reconcile_locked(self):
        queue=self.client.queue(); items=queue_items(queue); history=self.client.history()
        if not isinstance(history,dict): raise ValueError('Malformed history')
        active=False
        for attempt in self.attempts():
            meta=metadata(attempt)
            running=[item for item in items if tuple_metadata(item)==meta]
            finished=[(pid,value) for pid,value in history.items() if isinstance(value,dict) and tuple_metadata(value.get('prompt'))==meta]
            if len(running)>1 or len(finished)>1 or (running and finished):
                self.store.fail_attempt(attempt['intent'],'unknown','Duplicate/ambiguous matching intent in Comfy'); continue
            if running:
                pid=running[0][1]
                with self.store.db:
                    self.store.db.execute("UPDATE attempts SET state='submitted',prompt_id=?,submitted=COALESCE(submitted,?),error=NULL WHERE intent=?",(pid,time.time(),attempt['intent']))
                    self.store.db.execute("UPDATE jobs SET state='submitted',prompt_id=?,error=NULL WHERE id=?",(pid,attempt['job_id']))
                active=True; continue
            if finished:
                pid,entry=finished[0]
                atomic_json(confined(self.store.root,Path('history')/(attempt['intent']+'.json')),entry)
                if entry.get('status',{}).get('status_str')=='error':
                    self.store.fail_attempt(attempt['intent'],'failed','Comfy execution error: '+canonical(entry.get('status',{}))[:1500]); continue
                job=self.store.job(attempt['job_id']); recipe=self.store.recipe(job['recipe_hash'])
                outputs=entry.get('outputs',{}).get(recipe['output_node'],{})
                files=outputs.get(recipe.get('output_collection','images' if job['kind']=='image' else 'images'),[])
                try:
                    if len(files)!=1: raise ValueError('Expected exactly one result; missing or ambiguous output')
                    item=files[0]
                    if item.get('type')!='output': raise ValueError('Only persistent output files are accepted')
                    path=confined(self.store.config['output_root'],Path(item.get('subfolder',''))/item['filename'])
                    self.register(attempt,path,pid)
                except (ValueError,OSError,KeyError) as error:
                    self.store.fail_attempt(attempt['intent'],'failed',str(error))
                continue
            # Comfy restarted/lost history. Only complete, embedded-intent media is evidence.
            _,files=self.paths_for(attempt)
            candidates=[p for p in files if p.suffix.lower() in ('.png','.mp4','.webm','.mkv')]
            try:
                if len(candidates)==1:
                    self.register(attempt,candidates[0],attempt['prompt_id']); continue
                reason='No matching queue/history/output; explicit reconciliation required' if not candidates else 'Multiple output candidates; manual reconciliation required'
            except (ValueError,OSError,KeyError) as error: reason='Unverified output: '+str(error)
            self.store.fail_attempt(attempt['intent'],'unknown',reason)
        return active,items

    def submit_one(self, job):
        store=self.store
        preflight_started=time.monotonic()
        if self.disk_free()<30*1024**3:
            store.state(job['id'],'failed','Less than 30 GiB free before submission'); return False
        number=job['attempt']+1
        if number>3:
            store.state(job['id'],'failed','Three-attempt ceiling reached'); return False
        intent=uuid.uuid4().hex
        path=confined(store.root,Path('results')/(job['id']+'--'+intent+'--a'+str(number)+'--r'+job['recipe_hash']))
        path.parent.mkdir(parents=True,exist_ok=True)
        attempt=dict(intent=intent,job_id=job['id'],number=number,recipe_hash=job['recipe_hash'],prefix=path.relative_to(store.config['output_root']).as_posix(),state='submitting')
        try:
            graph,recipe=prepare_graph(store,job,attempt)
            if list(path.parent.glob(path.name+'*')): raise ValueError('Output prefix already exists')
        except (ValueError,OSError,KeyError) as error:
            store.state(job['id'],'failed','Preflight: '+str(error)); return False
        # Check pause/foreign queue again after expensive model/input checks.
        if store.paused() or queue_items(self.client.queue()): return False
        preflight_seconds=round(time.monotonic()-preflight_started,3)
        self.checkpoint('before_intent_commit')
        with store.db:
            changed=store.db.execute("UPDATE jobs SET state='submitting',attempt=?,prompt_id=NULL,error=NULL WHERE id=? AND state='pending'",(number,job['id'])).rowcount
            if changed!=1: raise RuntimeError('Job no longer pending')
            store.db.execute('INSERT INTO attempts(intent,job_id,number,recipe_hash,state,prefix,started,preflight_seconds) VALUES(?,?,?,?,?,?,?,?)',(intent,job['id'],number,job['recipe_hash'],'submitting',attempt['prefix'],time.time(),preflight_seconds))
        atomic_json(confined(store.root,Path('requests')/(intent+'.json')),dict(attempt=attempt,graph=graph))
        self.checkpoint('before_submit')
        print('SUBMIT '+job['id']+' intent='+intent+' preflight_seconds='+str(preflight_seconds),file=sys.stderr,flush=True)
        try:
            response=self.client.submit(graph,attempt)
            self.checkpoint('after_submit_response')
            pid=response['prompt_id']
            if not isinstance(pid,str) or not pid: raise ValueError('Missing prompt ID')
        except Rejected as error:
            store.fail_attempt(intent,'failed','Comfy rejected: '+str(error)); return True
        except Exception as error:
            store.fail_attempt(intent,'unknown','Submission response uncertain: '+str(error)); return True
        with store.db:
            store.db.execute("UPDATE attempts SET state='submitted',prompt_id=?,submitted=? WHERE intent=?",(pid,time.time(),intent))
            store.db.execute("UPDATE jobs SET state='submitted',prompt_id=? WHERE id=?",(pid,job['id']))
        return True

    def run(self, limit=1, watch=False, max_wait=900):
        if limit is not None and limit<1: raise ValueError('Limit must be positive')
        if max_wait<=0: raise ValueError('Wait ceiling must be positive')
        with GpuLock(self.lock_path):
            self.server_guard(); submissions=0; active_since=None
            while True:
                active,items=self.reconcile_locked()
                if active:
                    # Pause never interrupts current work, even if an external job joined behind it.
                    if active_since is None: active_since=time.monotonic()
                    if time.monotonic()-active_since>=max_wait:
                        raise TimeoutError('Current attempt is still queued/running; preserved for reconciliation, never interrupted')
                    time.sleep(self.poll); continue
                active_since=None
                if limit is not None and submissions>=limit: break
                pending=self.store.rows("SELECT * FROM jobs WHERE state='pending' ORDER BY created,id LIMIT 1")
                if self.store.paused() or items or not pending:
                    if not watch: break
                    time.sleep(self.poll); continue
                if self.submit_one(pending[0]): submissions+=1
            return self.store.rows('SELECT id,state,error FROM jobs ORDER BY created,id')

    def reconcile(self, mark_failed=None, retry=None, reason=None):
        with GpuLock(self.lock_path):
            self.server_guard(); self.reconcile_locked()
            if mark_failed:
                rows=self.store.rows('SELECT * FROM attempts WHERE intent=?',(mark_failed,))
                if not rows or rows[0]['state']!='unknown' or not reason: raise ValueError('Only an exact unknown intent may be marked failed, with a reason')
                self.store.fail_attempt(mark_failed,'failed','Operator confirmed: '+reason)
            if retry:
                job=self.store.job(retry)
                if job['state']!='failed' or job['attempt']>=3 or not reason: raise ValueError('Explicit retry requires failed job, reason, fewer than three attempts')
                self.store.state(retry,'pending','Operator retry: '+reason)
