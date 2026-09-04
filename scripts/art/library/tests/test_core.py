import sys
from pathlib import Path
import tempfile
import unittest
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from library.common import confined, GpuLock
from library.store import Store

class CoreTests(unittest.TestCase):
    def test_paths_and_cross_database_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError): confined(root, '../escape')
            with GpuLock(root/'shared.lock'):
                with self.assertRaises(RuntimeError):
                    with GpuLock(root/'shared.lock'): pass
            with GpuLock(root/'shared.lock'): pass

    def test_target_root_cannot_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store.initialize(root/'output/jobs', root/'game', root/'input', root/'output')
            self.assertFalse(store.paused())
            store.pause(True); self.assertTrue(store.paused())
            with self.assertRaises(ValueError): Store.initialize(root/'output/jobs',root/'other-game',root/'input',root/'output')
            store.close()

if __name__ == '__main__': unittest.main()
