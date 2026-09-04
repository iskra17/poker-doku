"""Checks integrity boundaries of the bounded official-model range download."""
import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('download',Path(__file__).with_name('poker-doku-library-qwen-download.py'))
d=importlib.util.module_from_spec(spec); spec.loader.exec_module(d)

class RangeGuards(unittest.TestCase):
    def test_refuse_full_body_on_resume(self):
        with self.assertRaises(ValueError): d.verify_range(200,None,4096,8191,16384)

    def test_refuse_wrong_offset_or_total(self):
        for header in ('bytes 0-4095/16384','bytes 4096-8191/99999'):
            with self.assertRaises(ValueError): d.verify_range(206,header,4096,8191,16384)
        d.verify_range(206,'bytes 4096-8191/16384',4096,8191,16384)

    def test_target_stays_in_model_root(self):
        root=Path('D:/AI-Image-Video/models')
        with self.assertRaises(ValueError): d.within(root,root/'../../outside')
        self.assertEqual(d.within(root,root/'diffusion_models/model.safetensors'),(root/'diffusion_models/model.safetensors').resolve())

if __name__=='__main__': unittest.main()
