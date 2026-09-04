import hashlib
import json
import os
from pathlib import Path
import re

GPU_LOCK = Path('D:/AI-Image-Video/.poker-doku-gpu.lock')
DEFAULT_ROOT = Path('D:/AI-Image-Video/output/poker-doku-library')

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def confined(root, path):
    root = Path(root).resolve()
    path = Path(path)
    result = (path if path.is_absolute() else root/path).resolve()
    if not result.is_relative_to(root) or result == root:
        raise ValueError('Path must remain strictly inside the configured root')
    return result

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,39}', value):
        raise ValueError('ID must be 1..40 lowercase letters/digits/_/-')
    return value

def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name+'.writing')
    temp.write_text(canonical(value), encoding='utf8')
    os.replace(temp, path)

class GpuLock:
    """Process-lifetime OS lock, never an endpoint/DB-specific ownership flag."""
    def __init__(self, path=GPU_LOCK):
        self.path = Path(path)
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open('a+b')
        self.handle.seek(0, os.SEEK_END)
        if self.handle.tell() == 0:
            self.handle.write(b'0'); self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.handle.close(); self.handle = None
            raise RuntimeError('Another art GPU worker holds the shared OS lock') from error
        return self

    def __exit__(self, *args):
        if self.handle:
            self.handle.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close(); self.handle = None
