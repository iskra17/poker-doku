"""CPU-only Comfy protocol fixture, never connects to a real GPU service."""
import json
from pathlib import Path
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from library.comfy import META_KEY
from PIL import Image, PngImagePlugin

root=Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
state={'queue_running':[],'queue_pending':[],'history':{},'count':0,'mode':'complete'}
def finish(item):
    prefix=item[2]['save']['inputs']['filename_prefix']; path=root/'output'/(prefix+'_00001_.png')
    path.parent.mkdir(parents=True,exist_ok=True)
    info=PngImagePlugin.PngInfo(); info.add_text(META_KEY,json.dumps(item[3][META_KEY]))
    Image.new('RGB',(16,16),'blue').save(path,pnginfo=info)
    if state['mode']=='corrupt': path.write_bytes(b'broken PNG')
    output={'filename':path.name,'subfolder':path.parent.relative_to(root/'output').as_posix(),'type':'output'}
    state['history'][item[1]]={'prompt':item,'outputs':{'save':{'images':[output]}},'status':{'status_str':'success'}}
    if state['mode']=='duplicate': state['history'][item[1]+'duplicate']=state['history'][item[1]]

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send(self,value):
        data=json.dumps(value).encode(); self.send_response(200); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if self.path=='/system_stats': self.send({'system':{'argv':['main.py','--input-directory',str(root/'input'),'--output-directory',str(root/'output')]}})
        elif self.path=='/queue': self.send({k:state[k] for k in ('queue_running','queue_pending')})
        elif self.path=='/history': self.send(state['history'])
        elif self.path=='/test/state': self.send(state)
        else: self.send_error(404)
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path=='/prompt':
            state['count']+=1; pid='fake-'+str(state['count'])
            item=[state['count'],pid,data['prompt'],data['extra_data'],['save']]
            (root/'accepted.jsonl').open('a').write(json.dumps(item)+'\n')
            if state['mode']=='hold': state['queue_running'].append(item)
            else: finish(item)
            if state['mode']=='drop': self.connection.shutdown(2); self.connection.close(); return
            self.send({'prompt_id':pid})
        elif self.path=='/test/control':
            if data.get('finish'):
                for item in state['queue_running']: finish(item)
                state['queue_running']=[]
            if data.get('clear_history'): state['history']={}
            if data.get('escape_output'):
                for entry in state['history'].values(): entry['outputs']['save']['images'][0]['subfolder']='../../outside'
            if data.get('execution_error'):
                for entry in state['history'].values(): entry['status']={'status_str':'error','messages':[['execution_error',{'exception_message':'fixture failure'}]]}
            if data.get('foreign'): state['queue_pending']=[[99,'external',{}, {},[]]]
            if data.get('clear_queue'): state['queue_pending']=[]; state['queue_running']=[]
            if 'mode' in data: state['mode']=data['mode']
            self.send(state)
        else: self.send_error(404)

server=HTTPServer(('127.0.0.1',0),Handler)
(root/'ready.json').write_text(json.dumps({'port':server.server_port}))
server.serve_forever()
