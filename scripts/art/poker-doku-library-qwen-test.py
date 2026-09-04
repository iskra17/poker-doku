"""A1c submission boundaries; no GPU or model downloads in these tests."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('qwen',Path(__file__).with_name('poker-doku-library-qwen.py'))
q=importlib.util.module_from_spec(spec); spec.loader.exec_module(q)

class PilotGuards(unittest.TestCase):
    def test_exact_initial_four(self):
        jobs=q.make_jobs()
        q.validate_jobs(jobs)
        self.assertEqual(len(jobs),4)
        with self.assertRaises(ValueError): q.validate_jobs(jobs+[copy.deepcopy(jobs[0])])
        altered=copy.deepcopy(jobs); altered[0]['id']='unapproved-scene'
        with self.assertRaises(ValueError): q.validate_jobs(altered)

    def test_uncertain_or_failed_submission_blocks_more_work(self):
        for state in ('unknown','submitted','failed'):
            jobs=q.make_jobs(); jobs[0]['status']=state
            with self.assertRaises(RuntimeError): q.require_resolved(jobs)
        jobs=q.make_jobs(); jobs[0]['status']='generated'; q.require_resolved(jobs)

    def test_other_queue_is_not_shared(self):
        with self.assertRaises(RuntimeError): q.require_idle({'queue_running':[1],'queue_pending':[]})
        with self.assertRaises(RuntimeError): q.require_idle({'queue_running':[],'queue_pending':[1]})

    def test_outputs_cannot_overwrite_references(self):
        graph=q.make_graph(q.make_jobs()[0])
        self.assertTrue(graph['17']['inputs']['filename_prefix'].startswith('poker-doku-library/a1c-20260905/'))
        self.assertNotIn('public/',graph['17']['inputs']['filename_prefix'])
        self.assertEqual(graph['15']['inputs']['steps'],4)
        self.assertEqual(graph['15']['inputs']['cfg'],1)
        self.assertEqual(graph['8']['class_type'],'TextEncodeQwenImageEditPlus')

if __name__=='__main__': unittest.main()
