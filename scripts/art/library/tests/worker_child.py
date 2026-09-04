"""Process crash/lock fixture. Not exposed by the production CLI."""
import os
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from library.common import GpuLock
from library.store import Store
from library.comfy import Comfy
from library.worker import Worker
if sys.argv[1]=='lock':
    with GpuLock(sys.argv[2]):
        Path(sys.argv[3]).write_text('locked')
        time.sleep(30)
else:
    root,endpoint,lock,stage=sys.argv[1:5]
    def checkpoint(point):
        if point==stage: os._exit(77)
    store=Store(root)
    try: Worker(store,Comfy(endpoint),lock_path=lock,poll=.03,checkpoint=checkpoint,disk_free=lambda:10**12).run(limit=2)
    finally: store.close()
