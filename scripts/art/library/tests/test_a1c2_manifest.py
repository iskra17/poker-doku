import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from library.common import sha

class ApprovedManifestTests(unittest.TestCase):
    def test_twelve_approved_jobs_fixed_seeds_and_original_recipe(self):
        directory=Path(__file__).resolve().parents[1]/'recipes'
        manifest=json.loads((directory/'a1c2-20260905.manifest.json').read_text(encoding='utf8'))
        expected=['sakura-garden-walk-q1','sakura-victory-q1','sakura-rain-veranda-q1','sakura-library-q1','elena-lesson-q1','elena-river-walk-q1','elena-victory-q1','elena-coffee-q1','sakura-garden-walk-q2','sakura-library-q2','elena-lesson-q2','elena-river-walk-q2']
        self.assertEqual([j['id'] for j in manifest['jobs']],expected)
        self.assertEqual([j['seed'] for j in manifest['jobs']],list(range(509020261400,509020261412)))
        self.assertEqual(len({(j['character'],j['scene']) for j in manifest['jobs']}),8)
        self.assertTrue(all('fully clothed adult woman' in j['prompt'] and 'original clothing colors' in j['prompt'] for j in manifest['jobs']))
        recipe=json.loads((directory/manifest['recipe']).read_text(encoding='utf8'))
        self.assertEqual(sha(directory/recipe['workflow']['path']),recipe['workflow']['sha256'])
        self.assertEqual(recipe['provenance']['steps'],4)

if __name__=='__main__': unittest.main()
