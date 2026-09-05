import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from library.common import sha
from library.recipe import ModelHashCache

class ModelCacheTests(unittest.TestCase):
    def test_unchanged_reuses_only_in_same_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'model'; path.write_bytes(b'original'); asset=dict(path=str(path),sha256=sha(path))
            with patch('library.recipe.sha',wraps=sha) as digest:
                cache=ModelHashCache(); cache.verify(asset); cache.verify(asset)
                self.assertEqual(digest.call_count,1)
                ModelHashCache().verify(asset); self.assertEqual(digest.call_count,2)
    def test_same_size_change_and_replace_invalidate(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'model'; path.write_bytes(b'original'); asset=dict(path=str(path),sha256=sha(path)); cache=ModelHashCache(); cache.verify(asset)
            before=path.stat(); path.write_bytes(b'modified'); os.utime(path,ns=(before.st_atime_ns,before.st_mtime_ns+1_000_000))
            with self.assertRaises(ValueError): cache.verify(asset)
            replacement=Path(folder)/'replacement'; replacement.write_bytes(b'original'); os.replace(replacement,path)
            with patch('library.recipe.sha',wraps=sha) as digest:
                cache.verify(asset); self.assertEqual(digest.call_count,1)
                with self.assertRaises(ValueError): cache.verify(dict(asset,sha256='0'*64))
                self.assertEqual(digest.call_count,2)
    def test_file_changes_during_hash_not_cached(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'model'; path.write_bytes(b'original'); asset=dict(path=str(path),sha256=sha(path)); cache=ModelHashCache()
            def unstable(p):
                value=sha(p); p.write_bytes(b'modified'); return value
            with patch('library.recipe.sha',side_effect=unstable):
                with self.assertRaises(ValueError): cache.verify(asset)

if __name__=='__main__': unittest.main()
