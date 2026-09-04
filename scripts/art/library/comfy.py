import json
import urllib.error
import urllib.parse
import urllib.request

META_KEY = 'poker_doku_art'

def metadata(attempt):
    return dict(intent=attempt['intent'], attempt=attempt['number'], recipe_hash=attempt['recipe_hash'],job_id=attempt['job_id'])

def tuple_metadata(item):
    # Comfy server.py queues (number, prompt_id, graph, extra_data, outputs, sensitive).
    if isinstance(item,(list,tuple)) and len(item)>3 and isinstance(item[3],dict):
        return item[3].get(META_KEY)
    return None

class Rejected(RuntimeError): pass

class Comfy:
    def __init__(self, endpoint='http://127.0.0.1:8188',timeout=30):
        url=urllib.parse.urlparse(endpoint)
        if url.scheme!='http' or url.hostname not in ('localhost','127.0.0.1','::1') or url.path not in ('','/') or url.username or url.query or url.fragment:
            raise ValueError('Only a local ComfyUI HTTP endpoint is supported')
        self.endpoint=endpoint.rstrip('/'); self.timeout=timeout

    def request(self, route, data=None):
        request=urllib.request.Request(self.endpoint+route,None if data is None else json.dumps(data).encode(),{'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=self.timeout) as response: return json.load(response)
        except urllib.error.HTTPError as error:
            if route=='/prompt' and error.code==400: raise Rejected(error.read().decode()[:1000]) from error
            raise
    def queue(self): return self.request('/queue')
    def history(self): return self.request('/history')
    def stats(self): return self.request('/system_stats')
    def submit(self, graph, attempt):
        meta=metadata(attempt)
        return self.request('/prompt',dict(prompt=graph,client_id='poker-doku-library',extra_data={META_KEY:meta,'extra_pnginfo':{META_KEY:meta}}))

def queue_items(queue):
    if not isinstance(queue,dict) or not isinstance(queue.get('queue_running'),list) or not isinstance(queue.get('queue_pending'),list):
        raise ValueError('Malformed Comfy queue; refuse to infer idle')
    return queue['queue_running']+queue['queue_pending']
