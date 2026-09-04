"""A1 batch guards: run directly with the ComfyUI Python interpreter."""
import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('pilot', Path(__file__).with_name('poker-doku-library.py'))
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)

class Guards(unittest.TestCase):
    def test_batch_is_bounded_and_ids_unique(self):
        jobs = pilot.make_jobs()
        self.assertEqual(len(jobs), 24)
        self.assertEqual(len({j['id'] for j in jobs}), 24)
        for character in ('sakura', 'elena'):
            self.assertEqual(len({j['scene'] for j in jobs if j['character'] == character}), 6)

    def test_no_accidental_resubmission(self):
        for state in ('submitted', 'generated', 'failed', 'unknown'):
            with self.assertRaises(ValueError):
                pilot.require_new({'status': state})
        pilot.require_new({'status': 'planned'})

    def test_queue_must_be_empty(self):
        for queue in ({'queue_running': [1], 'queue_pending': []}, {'queue_running': [], 'queue_pending': [1]}):
            with self.assertRaises(RuntimeError):
                pilot.require_idle(queue)
        pilot.require_idle({'queue_running': [], 'queue_pending': []})

    def test_unresolved_batch_must_be_reconciled(self):
        for state in ('unknown', 'submitted', 'failed'):
            with self.assertRaises(RuntimeError):
                pilot.require_resolved([{'status':state}, {'status':'planned'}])
        pilot.require_resolved([{'status':'generated'}, {'status':'planned'}])

if __name__ == '__main__':
    unittest.main()
