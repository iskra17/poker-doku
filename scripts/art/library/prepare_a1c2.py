"""Write the twelve explicitly approved A1c2 jobs; does not import or submit them."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from library.common import sha

ROOT=Path(__file__).resolve().parents[3]
DEST=Path(__file__).parent/'recipes'
TARGET='C:/code/claude/poker-doku/.worktrees/story-expansion-control'
SCENES=[
 ('sakura-garden-walk-q1','garden-walk','full-body side view moving left to right','cherry blossoms beside path','relaxed','Show her walking from left to right along a stone path in a spacious Japanese garden in full-body side view. She holds a small closed book against her chest with both arms and looks at the cherry blossoms beside the path with a relaxed expression. Show the broad garden setting; no eye contact with the camera.'),
 ('sakura-victory-q1','victory','three-quarter face, slightly elevated camera','both eyes closed','brief relieved laugh','Seat her beside a green felt poker table immediately after a small victory. Use a slightly elevated camera and a three-quarter view of her face. She closes both eyes and laughs briefly with relief. Both hands rest together naturally in her lap. All chips remain on the table.'),
 ('sakura-rain-veranda-q1','rain-veranda','waist-up right-facing profile','rain falling into garden','thoughtful','Place her on a wooden veranda during rain. Show a waist-up right-facing profile, gently resting her elbows on the railing and looking at the rain falling into the garden. Her expression is thoughtful. Her hands rest on the railing, never cover her chin or face.'),
 ('sakura-library-q1','library','three-quarter rear view beside bookshelf','book on low shelf','quiet concentration','Place her beside a bookshelf in warm indoor light, viewed from three quarters behind. Only a small contour of her profile is visible over her shoulder; she does not look back. One hand draws a book from a low shelf and the other supports the underside of that book. Her eyes look toward the book.'),
 ('elena-lesson-q1','lesson','over right rear shoulder','open notebook on table','composed teacher','Position the camera behind her right shoulder at a green felt practice table. She points one index finger at a single place on an open notebook containing faint abstract marks, no readable text. The other hand rests flat on the table. Her eyes look down at the notebook with a composed teaching expression. Preserve her black suit and very long silver hair.'),
 ('elena-river-walk-q1','river-walk','wide full-body left three-quarter profile','distant river lights','mature and calm','Show her walking along a river at dusk in a wide full-body composition. Show a left-facing three-quarter profile as she looks at distant lights across the river. Both hands hang naturally beside her body. Keep her black tailored suit and mature calm expression.'),
 ('elena-victory-q1','victory','shoulder-up three-quarter close-up','off-screen opponent to right','restrained confident smile','Place her beside a poker table in a shoulder-up three-quarter close-up. Her chin is slightly raised, her eyes remain narrow and mature, and she has a restrained confident smile. She looks toward an off-screen opponent to the right of the frame, not at the viewer. Her hands are outside the frame.'),
 ('elena-coffee-q1','coffee','oblique view from above cafe table','coffee cup below','thoughtful','Place her at a cafe table, viewed obliquely from above. One hand gently holds the handle of a coffee cup and the other hand rests beside its saucer. She looks down at the coffee with a thoughtful expression. Preserve her black suit and pale grey necktie.'),
 ('sakura-garden-walk-q2','garden-walk','full-body rear three-quarter view','cherry blossoms on right','relaxed','Show her walking along a stone path in a spacious Japanese garden in a full-body rear three-quarter view. She holds a small closed book against her chest with both arms and turns her head toward cherry blossoms on the right. She must not turn back toward the camera. Her expression is relaxed and the broad garden remains visible.'),
 ('sakura-library-q2','library','waist-up side view beside bookshelf','open book in both hands','quiet concentration','Place her beside a bookshelf in warm indoor light in a waist-up side view. She has just taken a book from a low shelf and now holds it open with both hands, looking down at its pages with quiet concentration. The pages contain faint abstract lines, no readable text. She does not look toward the viewer.'),
 ('elena-lesson-q2','lesson','over left rear shoulder','one of three rows of chip stacks','composed teacher','Position the camera behind her left shoulder at a green felt practice table. Three rows of neat chip stacks are arranged on the felt. She points an index finger toward one stack while the other hand rests flat on the table. Her eyes look directly down at that stack with a composed teaching expression. Show clear anatomically natural hand contact. Preserve her black suit and very long silver hair.'),
 ('elena-river-walk-q2','river-walk','full-body side view beside river railing','distant river','mature and calm','Show her stopped beside a river railing at dusk in a full-body side view. Both hands rest lightly and naturally on top of the railing. She looks far across the river with a mature, calm expression. Preserve her black tailored suit and long silver hair; no camera eye contact.'),
]
PRESERVE={
 'sakura':'Keep the same adult 22-year-old woman, her exact soft pink bob haircut, pink eyes, face shape, one small white cherry-blossom hairpin, cream ivory cardigan, white collared blouse and pink neck ribbon. Preserve the original clothing colors, delicate linework, softly painted shading, fine hair highlights and Japanese visual-novel art style.',
 'elena':'Keep the same adult 27-year-old woman, her mature elongated face, narrow grey-blue eyes, defined jawline, very long straight silver hair, small silver hoop earrings, black tailored suit jacket, white collared shirt and pale grey necktie. Do not enlarge or round her eyes or shorten her jaw. Preserve the original clothing colors, fine linework, silky hair highlights, softly painted shading and Japanese visual-novel art style.',
}

def write_new_or_equal(path,data):
    if path.exists():
        if path.read_bytes()!=data: raise ValueError('Refusing to change existing prepared file: '+str(path))
    else:
        path.parent.mkdir(parents=True,exist_ok=True)
        with path.open('xb') as stream: stream.write(data)

def main():
    record=json.loads((ROOT/'scripts/art/poker-doku-library-qwen-manifest.json').read_text(encoding='utf8'))
    source=ROOT/'scripts/art/workflows/poker-doku-qwen-edit-2511.json'
    if sha(source)!=record['workflow_sha256'] or not record['models_verified']: raise ValueError('A1c source was not verified')
    workflow=DEST/'qwen-edit-2511-a2.workflow.json'; write_new_or_equal(workflow,source.read_bytes())
    graph=json.loads(source.read_text())
    recipe=dict(version=1,queue_approved=True,scope='general',kind='image',
        approval_document='docs/superpowers/plans/2026-09-05-art-a1c-followup.md',
        workflow=dict(path=workflow.name,sha256=sha(workflow)),
        models=[dict(path=r['target'],sha256=r['sha256'],repo=r['repo'],revision=r['revision']) for r in record['models']],
        allowed_nodes=sorted({v['class_type'] for v in graph.values()}),
        bindings=dict(prompt=['8','prompt'],seed=['15','seed'],output_prefix=['17','filename_prefix'],inputs=dict(reference=['4','image'])),
        output_node='17',output_collection='images',media=dict(width=832,height=1248),
        provenance=dict(official_template_sha256=record['official_template_sha256'],official_docs=record['official_docs'],sampler='euler',scheduler='simple',steps=4,cfg=1.0))
    jobs=[]
    for index,(job_id,scene,angle,gaze,expression,action) in enumerate(SCENES):
        character=job_id.split('-')[0]; reference=record['references'][character]
        source_ref=ROOT/reference['source']
        if sha(source_ref)!=reference['source_sha256'] or sha(reference['input'])!=reference['input_sha256']: raise ValueError('Canonical reference changed')
        jobs.append(dict(id=job_id,character=character,scene=scene,seed=509020261400+index,
            angle=angle,gaze=gaze,expression=expression,outfit='original cream cardigan, white blouse and pink ribbon' if character=='sakura' else 'original black suit, white shirt and pale grey necktie',
            inputs=dict(reference=dict(path=reference['input'],sha256=reference['input_sha256'])),
            canonical_source=dict(path=str(source_ref),sha256=reference['source_sha256']),
            prompt='Edit the supplied illustration into a new scene of the SAME woman. '+PRESERVE[character]+' '+action+' The result is one coherent illustration with one fully clothed adult woman. No collage, duplicate person, text, logo or watermark. Preserve her identity and rendering style while changing the camera, pose, gaze and setting as instructed.'))
    manifest=dict(version=1,scope='general',target_root=TARGET,recipe='qwen-edit-2511-a2.recipe.json',
        output_root='D:/AI-Image-Video/output/poker-doku-library/a1c2-20260905',
        approval_document='docs/superpowers/plans/2026-09-05-art-a1c-followup.md',authorized_jobs=12,jobs=jobs)
    for name,value in [('qwen-edit-2511-a2.recipe.json',recipe),('a1c2-20260905.manifest.json',manifest)]:
        write_new_or_equal(DEST/name,(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode())
    print(DEST/'a1c2-20260905.manifest.json')

if __name__=='__main__': main()
