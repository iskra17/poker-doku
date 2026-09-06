"""보너스 CG 원장 도우미 — 승인된 GPT Image 2 원화를 라이브러리 원장(scope 'bonus')에 등록하고 H3 영상 매니페스트를 만든다.

실행은 포터블 Comfy 파이썬(PIL 포함)으로:
  $PY = 'C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe'
  & $PY -B scripts/art/bonus-cg/ledger_bonus.py receipts   <staging> <id:scene ...>   # 외부 원화 영수증 작성 + import-external-image
  & $PY -B scripts/art/bonus-cg/ledger_bonus.py approve    <id:scene ...>             # 원장 job 승인(정확한 output_hash로 review approved)
  & $PY -B scripts/art/bonus-cg/ledger_bonus.py video-manifest <id:scene ...>         # 승인된 부모로 H3 video 매니페스트 작성(+ import)
  & $PY -B scripts/art/bonus-cg/ledger_bonus.py approve-videos <id:scene ...>         # 영상 검수 뒤 승인
  & $PY -B scripts/art/bonus-cg/ledger_bonus.py export     <id:scene ...>             # webp + mp4/webm 쌍을 게임 워크트리로 내보내기

원장 루트/워크트리/입력 폴더는 아래 상수. 이 스크립트는 이미지를 생성·승인하지 않는다 — 사용자가 검수한 목록만 받는다.
"""
import hashlib, json, pathlib, subprocess, sys, sqlite3

REPO = pathlib.Path(__file__).resolve().parents[3]
PLAN = REPO / 'scripts/art/bonus-cg/bonus-cg-plan-2026-09-06.json'
WORKER = REPO / 'scripts/art/library-worker.py'
RECIPES = REPO / 'scripts/art/library/recipes'
RECEIPT_DIR = RECIPES / 'bonus-cg-20260906'
LEDGER_ROOT = pathlib.Path('D:/AI-Image-Video/output/poker-doku-library/bonus-cg-20260906')
INPUT_DIR = pathlib.Path('D:/AI-Image-Video/input')
TARGET_ROOT = 'C:/code/claude/poker-doku/.worktrees/bonus-cg-assets'
APPROVAL_DOC = 'docs/superpowers/plans/2026-09-06-bonus-cg-pipeline.md'
VIDEO_RECIPE = 'h3-fl2v-bonus.recipe.json'
SEED_BASE = 509020266000

MOTION = {
    'beach': 'gentle water sparkle and small waves, hair and fabric stirring in the sea breeze, a single slow blink',
    'gym': 'subtle breathing, a faint sway of loose hair, a single slow blink, soft light flicker',
    'yoga': 'calm slow breathing, curtain or leaves stirring softly, a single slow blink',
    'sing': 'stage light shimmer and haze drifting, hair strands moving slightly, a single slow blink',
    'casual': 'ambient drift such as steam, petals, snow or leaves, hair stirring, a single slow blink',
}


def sha(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def plan():
    return json.loads(PLAN.read_text(encoding='utf8'))


def character(pl, cid):
    for c in pl['characters']:
        if c['id'] == cid:
            return c
    raise SystemExit(f'unknown character {cid}')


def parse(args):
    out = []
    for arg in args:
        cid, scene = arg.split(':')
        out.append((cid, scene))
    if not out:
        raise SystemExit('give at least one id:scene')
    return out


def worker(*argv):
    cmd = [sys.executable, '-B', str(WORKER), '--root', str(LEDGER_ROOT), *argv]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf8', errors='replace')
    print(f'$ library-worker {" ".join(argv[:2])} … exit={proc.returncode}')
    if proc.stdout.strip():
        print(proc.stdout.strip()[-800:])
    if proc.returncode != 0:
        print(proc.stderr.strip()[-800:], file=sys.stderr)
    return proc.returncode


def db():
    con = sqlite3.connect(LEDGER_ROOT / 'library.sqlite3')
    con.row_factory = sqlite3.Row
    return con


def outfit_of(text):
    head = text.split(', she', 1)[0]
    return head[len('Wearing '):] if head.startswith('Wearing ') else head


def gaze_of(text):
    marker = 'gaze '
    idx = text.find(marker)
    if idx < 0:
        return 'see prompt'
    return text[idx + len(marker):].split(',', 1)[0].strip()


def image_job_id(cid, scene):
    return f'bonus-{cid}-{scene}'


def video_job_of(con, image):
    """이미지 job의 최신 비반려 video job id — 반려 뒤 재생성(-v2 …)이 있으면 그 id를 쓴다."""
    row = con.execute(
        "SELECT id FROM jobs WHERE json_extract(spec,'$.job.parent_job')=? AND state!='rejected' ORDER BY created DESC LIMIT 1",
        (image,)).fetchone()
    return row['id'] if row else f'{image}-video'


def cmd_receipts(staging, pairs):
    pl = plan()
    RECEIPT_DIR.mkdir(parents=True, exist_ok=True)
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    for cid, scene in pairs:
        c = character(pl, cid)
        text = c['scenes'][scene]
        src = pathlib.Path(staging) / 'out' / cid / f'{scene}.png'
        if not src.is_file():
            print(f'skip {cid}:{scene} — missing {src}')
            continue
        job_id = image_job_id(cid, scene)
        dest = INPUT_DIR / f'pd-{job_id}.png'
        if not dest.exists():
            dest.write_bytes(src.read_bytes())
        elif sha(dest) != sha(src):
            raise SystemExit(f'{dest} exists with different bytes — inspect before overwriting')
        from PIL import Image
        with Image.open(dest) as image:
            width, height = image.size
        prompt_file = pathlib.Path(staging) / 'prompts' / f'{cid}.txt'
        refs = []
        for rel in [c['ref'], *[r['path'] for r in pl['style_refs']]]:
            p = pathlib.Path(staging) / rel
            if p.is_file():
                refs.append({'path': str(p).replace('\\', '/'), 'sha256': sha(p)})
        provenance = {
            'version': 1, 'provider': 'gpt-image-2', 'tool': 'codex exec image_gen (gpt-5.5 orchestrator)',
            'batch': pl['batch'], 'scope': 'bonus', 'character': cid, 'scene': scene, 'age': c['age'],
            'prompt': text, 'prompt_file': str(prompt_file).replace('\\', '/'),
            'content_rules': pl['content_rules'], 'references': refs,
            'original': {'path': str(src).replace('\\', '/'), 'sha256': sha(src), 'width': width, 'height': height},
        }
        prov_path = RECEIPT_DIR / f'{job_id}.provenance.json'
        prov_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding='utf8')
        receipt = {
            'version': 1, 'scope': 'bonus', 'source_type': 'external-image', 'provider': 'gpt-image-2',
            'id': job_id, 'character': cid, 'scene': scene, 'target_root': TARGET_ROOT,
            'source': {'path': str(dest).replace('\\', '/'), 'sha256': sha(dest)},
            'provenance': {'path': str(prov_path).replace('\\', '/'), 'sha256': sha(prov_path)},
            'prompt': text, 'angle': pl['scenes'][scene]['camera'], 'gaze': gaze_of(text),
            'expression': 'see prompt', 'outfit': outfit_of(text),
        }
        rec_path = RECEIPT_DIR / f'{job_id}.external.json'
        rec_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf8')
        worker('import-external-image', str(rec_path))


def approve(job_ids, reason):
    con = db()
    for job_id in job_ids:
        row = con.execute('SELECT output_hash, state FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not row:
            print(f'skip {job_id} — not in ledger')
            continue
        if row['state'] == 'approved':
            print(f'already approved {job_id}')
            continue
        worker('review', job_id, 'approved', '--sha256', row['output_hash'], '--reason', reason)


def cmd_approve(pairs):
    approve([image_job_id(c, s) for c, s in pairs], 'Full-resolution identity, outfit, anatomy and content-boundary review by the user')


def cmd_video_manifest(pairs):
    """영상 재생성(반려 뒤)은 환경변수로 변형: BONUS_VIDEO_SUFFIX=v2(새 job id), BONUS_SEED_OFFSET=1000(seed 변경),
    BONUS_VIDEO_EXTRA='…'(프롬프트에 덧붙일 고정 지시)."""
    import os
    suffix = os.environ.get('BONUS_VIDEO_SUFFIX', '')
    seed_offset = int(os.environ.get('BONUS_SEED_OFFSET', '0'))
    extra = os.environ.get('BONUS_VIDEO_EXTRA', '').strip()
    # BONUS_MOTION_OVERRIDE='…'이면 장면 기본 모션 큐(MOTION[scene])를 통째로 대체한다(장면과 안 맞는 단어를 빼야 할 때).
    motion_override = os.environ.get('BONUS_MOTION_OVERRIDE', '').strip()
    pl = plan()
    con = db()
    jobs = []
    for index, (cid, scene) in enumerate(pairs):
        parent = image_job_id(cid, scene)
        row = con.execute('SELECT output, output_hash, state FROM jobs WHERE id=?', (parent,)).fetchone()
        if not row or row['state'] != 'approved':
            print(f'skip {parent} — not approved in ledger')
            continue
        c = character(pl, cid)
        text = c['scenes'][scene]
        prompt = (
            'Animate the exact supplied premium anime event illustration with its fine linework, detailed fabric, luminous layered hair '
            f'and softly painted cinematic lighting fully preserved. One adult {c["age"]}-year-old woman ({c["name_ko"]}) in the same outfit. '
            f'Subtle ambient motion only: {motion_override or MOTION[scene]}. Hands, fingers, held objects and the pose remain fixed. Camera completely locked, '
            'no pan, zoom, shake or parallax. No extra people, no letters, captions, new objects, costume change or detail simplification. '
            'Preserve facial identity and anatomy throughout. Return naturally to the exact original pose and expression at the end for a seamless gentle ambient loop.'
            + (f' {extra}' if extra else '')
        )
        jobs.append({
            'id': f'{parent}-video{"-" + suffix if suffix else ""}', 'character': cid, 'scene': scene, 'parent_job': parent,
            'seed': SEED_BASE + seed_offset + index, 'angle': pl['scenes'][scene]['camera'], 'gaze': gaze_of(text),
            'expression': 'see prompt', 'outfit': outfit_of(text), 'prompt': prompt,
            'inputs': {'reference': {'path': row['output'], 'sha256': row['output_hash']}},
        })
    if not jobs:
        raise SystemExit('no approved parents')
    manifest = {
        'version': 1, 'scope': 'bonus', 'target_root': TARGET_ROOT, 'recipe': VIDEO_RECIPE,
        'output_root': str(LEDGER_ROOT).replace('\\', '/'), 'approval_document': APPROVAL_DOC,
        'authorized_jobs': len(jobs), 'jobs': jobs,
    }
    path = RECIPES / f'bonus-cg-20260906.video-{len(jobs)}-{jobs[0]["id"]}.manifest.json'
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')
    print('manifest', path)
    worker('import', str(path))


def cmd_approve_videos(pairs):
    con = db()
    approve([video_job_of(con, image_job_id(c, s)) for c, s in pairs], 'Loop reviewed: fixed camera, identity and outfit preserved, seamless first/last frame')


def cmd_export(pairs):
    con = db()
    for cid, scene in pairs:
        image = image_job_id(cid, scene)
        worker('export', image, '--target-root', TARGET_ROOT, '--path', f'public/assets/story/cg/{image}.webp')
        worker('export-video-pair', video_job_of(con, image), '--target-root', TARGET_ROOT, '--stem', f'public/assets/story/video/{image}')


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    command = argv[1]
    if command == 'receipts':
        cmd_receipts(argv[2], parse(argv[3:]))
    elif command == 'approve':
        cmd_approve(parse(argv[2:]))
    elif command == 'video-manifest':
        cmd_video_manifest(parse(argv[2:]))
    elif command == 'approve-videos':
        cmd_approve_videos(parse(argv[2:]))
    elif command == 'export':
        cmd_export(parse(argv[2:]))
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
