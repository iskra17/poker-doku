import json
from pathlib import Path
import subprocess
from .common import sha
from .comfy import META_KEY

def inspect_media(path, kind, expected, meta=None):
    try:
        return _inspect_media(path,kind,expected,meta)
    except (subprocess.SubprocessError,KeyError,TypeError,OverflowError) as error:
        raise ValueError('Media cannot be completely decoded/probed: '+str(error)) from error

def _inspect_media(path, kind, expected, meta=None):
    path=Path(path)
    if not path.is_file() or path.stat().st_size==0: raise ValueError('Missing or empty media')
    if kind=='image':
        from PIL import Image
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load(); width,height=image.size
            if meta is not None:
                if image.format!='PNG' or json.loads(image.info.get(META_KEY,'null'))!=meta:
                    raise ValueError('PNG intent/attempt/recipe metadata is missing or wrong')
        result=dict(width=width,height=height,bytes=path.stat().st_size)
    elif kind=='video':
        raw=subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,duration:format=duration:format_tags','-of','json',str(path)],stderr=subprocess.STDOUT,timeout=120)
        data=json.loads(raw); streams=data.get('streams',[])
        if len(streams)!=1: raise ValueError('Expected one video stream')
        stream=streams[0]; duration=float(stream.get('duration') or data['format']['duration'])
        frames=int(stream.get('nb_read_frames','0'))
        if meta is not None:
            tags={k.lower():v for k,v in data.get('format',{}).get('tags',{}).items()}
            embedded=json.loads(tags.get(META_KEY,'null'))
            if embedded is None:
                try: embedded=json.loads(tags.get('comment','{}')).get(META_KEY)
                except (ValueError,AttributeError): embedded=None
            if embedded!=meta: raise ValueError('Video intent metadata missing; preserve tags or use a reviewed metadata-capable saver')
        if duration<=0 or frames<expected.get('min_frames',2): raise ValueError('Empty or partial video')
        # Decode all frames, not merely trust MP4 header duration.
        subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(path),'-map','0:v:0','-f','null','-'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=120)
        result=dict(width=int(stream['width']),height=int(stream['height']),duration=duration,frames=frames,bytes=path.stat().st_size)
        if duration<expected.get('min_duration',0) or duration>expected.get('max_duration',3600): raise ValueError('Video duration outside recipe')
    else: raise ValueError('Unsupported media kind')
    for key in ('width','height'):
        if result[key]!=expected[key]: raise ValueError('Unexpected media '+key)
    result['sha256']=sha(path)
    return result
