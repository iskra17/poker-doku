"""Operator CLI. Read/review operations do not acquire the GPU lock."""
import argparse
import json
import sys
from .common import DEFAULT_ROOT
from .comfy import Comfy
from .store import Store
from .recipe import import_manifest
from .worker import Worker
from .review import decide,export,sheet
from .video_pair import export_video_pair
from .external_image import import_external_image

def parser():
    p=argparse.ArgumentParser(description='Local general-art durable queue; no automatic retry, approval or export')
    p.add_argument('--root',default=str(DEFAULT_ROOT)); p.add_argument('--endpoint',default='http://127.0.0.1:8188')
    commands=p.add_subparsers(dest='command',required=True)
    init=commands.add_parser('init'); init.add_argument('--target-root',required=True); init.add_argument('--input-root',default='D:/AI-Image-Video/input'); init.add_argument('--output-root',default='D:/AI-Image-Video/output')
    commands.add_parser('import').add_argument('manifest')
    commands.add_parser('import-external-image').add_argument('manifest')
    commands.add_parser('status'); commands.add_parser('pause'); commands.add_parser('resume'); commands.add_parser('sheet')
    run=commands.add_parser('run'); run.add_argument('--limit',type=int); run.add_argument('--watch',action='store_true'); run.add_argument('--max-wait',type=float,default=900)
    reconcile=commands.add_parser('reconcile'); action=reconcile.add_mutually_exclusive_group(); action.add_argument('--mark-failed',metavar='INTENT'); action.add_argument('--retry',metavar='JOB'); reconcile.add_argument('--reason')
    review=commands.add_parser('review'); review.add_argument('job'); review.add_argument('decision',choices=['approved','rejected']); review.add_argument('--reason',required=True); review.add_argument('--sha256',required=True,help='Exact full-resolution result hash reviewed by operator')
    publish=commands.add_parser('export'); publish.add_argument('job'); publish.add_argument('--target-root',required=True); publish.add_argument('--path',required=True)
    pair=commands.add_parser('export-video-pair'); pair.add_argument('job'); pair.add_argument('--target-root',required=True); pair.add_argument('--stem',required=True)
    return p

def main(argv=None):
    args=parser().parse_args(argv)
    if args.command=='init':
        store=Store.initialize(args.root,args.target_root,args.input_root,args.output_root)
        result=store.config; store.close()
    else:
        store=Store(args.root)
        try:
            if args.command=='import': result=import_manifest(store,args.manifest)
            elif args.command=='import-external-image': result=import_external_image(store,args.manifest)
            elif args.command=='status':
                result=dict(config=store.config,paused=store.paused(),jobs=store.rows('SELECT id,kind,character,scene,seed,state,attempt,prompt_id,output,output_hash,media,error FROM jobs ORDER BY created,id'),attempts=store.rows('SELECT * FROM attempts ORDER BY started'))
            elif args.command in ('pause','resume'): store.pause(args.command=='pause'); result={'paused':store.paused()}
            elif args.command=='run': result=Worker(store,Comfy(args.endpoint)).run(limit=args.limit if args.limit is not None else (None if args.watch else 1),watch=args.watch,max_wait=args.max_wait)
            elif args.command=='reconcile':
                Worker(store,Comfy(args.endpoint)).reconcile(mark_failed=args.mark_failed,retry=args.retry,reason=args.reason); result=store.rows('SELECT id,state,error FROM jobs ORDER BY created,id')
            elif args.command=='review':
                if store.job(args.job)['output_hash']!=args.sha256: raise ValueError('Review hash does not match recorded result')
                decide(store,args.job,args.decision,args.reason); result=store.job(args.job)
            elif args.command=='sheet': result=sheet(store)
            elif args.command=='export': result=export(store,args.job,args.target_root,args.path)
            elif args.command=='export-video-pair': result=export_video_pair(store,args.job,args.target_root,args.stem)
        finally: store.close()
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0

def entry():
    try: return main()
    except (ValueError,OSError,RuntimeError) as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False),file=sys.stderr); return 1
