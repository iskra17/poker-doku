"""컷신 영상 생성기 — MiniMax H3 fl2va, first_frame = last_frame = CG(이음새 없는 루프). 절차는 scripts/art/story-video.md.

사용: python scripts/art/story-video-h3.py <tag> [cgId ...]   (ComfyUI가 127.0.0.1:8188에 떠 있어야 한다)
입력: D:/AI-Image-Video/input/pd-<cgId>.png  출력: D:/AI-Image-Video/output/poker-doku/<cgId>-<tag>_0000N_.mp4
"""
import json, sys, time, urllib.request, glob, os
API = "http://127.0.0.1:8188"
OUT_DIR = r"D:\AI-Image-Video\output\poker-doku"
W, H = 768, 1152
LENGTH = int(os.environ.get("H3_LENGTH", "107"))  # 17k+5 grid @24fps: 90=3.75s, 107=4.46s, 124=5.17s
STEPS = 8
STYLE = ("Anime illustration, hand-drawn 2D animation look, perfectly fixed camera, no camera movement, no zoom, no pan. "
         "The video must start and end on the exact same frame for a seamless loop. No dialogue, no text, no subtitles, no logos. ")
CLIPS = {
  "story-cg-act1-belt-yellow": dict(seed=509020260901, prompt=STYLE +
    "A woman with dark purple hair tied up with a gold flower ornament, wearing a black-and-gold vest with a gold bow tie, "
    "holds a yellow belt with both hands in front of a wooden dojo gate at sunset. Subtle ambient motion only: cherry blossom "
    "petals drift slowly through the air, loose hair strands and the hanging gold tassels sway gently in a light breeze, the sunset "
    "clouds glow softly, warm light shimmers on the stone path. She keeps her gentle smile and blinks once slowly. "
    "Quiet ambient sound of a soft breeze and rustling petals."),
  "story-cg-act1-draco-boss": dict(seed=509020260902, prompt=STYLE +
    "A purple-haired woman in a dark suit adjusts her glasses beside a glowing holographic whiteboard while a small teal baby "
    "dragon sits on a poker table among chips, pouting with teary eyes. Subtle ambient motion only: the tiny flame on the dragon's "
    "tail tip flickers, tears glisten, the dragon's wings twitch and its cheeks puff softly, the whiteboard diagrams shimmer faintly, "
    "the lantern light flickers through the window, her long hair sways slightly, she keeps her calm smile. "
    "Quiet room ambience with faint chip clinks."),
  "sakura-scene-lv5": dict(seed=509020260903, prompt=STYLE +
    "A shy girl with short pink hair and a white flower hairpin, wearing a cream cardigan over a white blouse with a pink ribbon and "
    "a pink plaid skirt, holds out a playing card toward the viewer on a cherry blossom path at dusk. Subtle ambient motion only: "
    "cherry blossom petals fall gently everywhere, her hair and ribbon sway in a light breeze, she blinks slowly and her cheeks stay "
    "blushed, the stone lantern glows softly, the card in her outstretched hand trembles very slightly. "
    "Soft wind and rustling petals."),
  # --- 2026-09-04 2차 배치: 보상 CG 5 + 비비안 Lv5 ---
  "story-cg-act1-belt-white": dict(seed=509020260904, prompt=STYLE +
    "A woman with dark purple hair tied up with a gold flower ornament and hanging gold tassels, wearing a white shirt, a gold bow tie "
    "and a black-and-gold vest with a black pencil skirt, holds a neatly folded white martial-arts belt toward the viewer with both "
    "hands in front of a wooden dojo gate in soft daylight, cherry blossom trees behind her. Subtle ambient motion only: cherry "
    "blossom petals drift slowly through the air and across the stone path, loose hair strands and the gold tassels sway gently in a "
    "light breeze, the purple banners on the gate ripple very slightly, soft daylight shimmers. She keeps her gentle proud smile and "
    "blinks once slowly. Quiet ambient sound of a soft breeze and rustling petals."),
  "story-cg-act1-sakura-garden": dict(seed=509020260905, prompt=STYLE +
    "A shy girl with short pink hair and a white flower hairpin, wearing a cream cardigan over a white blouse with a pink ribbon and a "
    "purple plaid skirt, holds out a single playing card (card back only) toward the viewer with both hands on a stone garden path at "
    "night, glowing stone lanterns and a cherry blossom tree beside her. Subtle ambient motion only: cherry blossom petals fall gently "
    "everywhere, her hair and ribbon sway in a light breeze, the stone lantern glow flickers warmly, she blinks slowly with her cheeks "
    "staying blushed, the card in her outstretched hands trembles very slightly. Soft wind and rustling petals."),
  "story-cg-act2-paeng-boss": dict(seed=509020260906, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons, wearing a black cropped jacket with gold trim over a red top and "
    "black pants, stands with her arms crossed and a confident smirk behind a green poker table; in front of her a large round black-"
    "and-white penguin creature with an ice-crystal crest and a pale blue bow tie sits on the table looking sulky and sweating, "
    "surrounded by poker chips, playing cards and scattered ice shards, red lanterns glowing in a dim room. Subtle ambient motion "
    "only: the ice shards glitter and a few tiny ice crystals shimmer, a single sweat drop slides down the penguin's head, the penguin "
    "blinks and its cheeks puff faintly, the red lantern light flickers, her twin tails sway slightly, she keeps her smirk and blinks "
    "once. Quiet room ambience with faint chip clinks."),
  "story-cg-act2-ara-victory": dict(seed=509020260907, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons, wearing a red-and-black esports jersey and black shorts with "
    "headphones around her neck, grins with one fist raised high in victory and the other fist clenched at her side, on a wooden "
    "rooftop deck at night with pagoda roofs and a glowing city skyline behind her, poker chips flying through the air around her. "
    "Subtle ambient motion only: the poker chips float and spin slowly in the air, her twin tails and loose hair strands stream "
    "gently in the night wind, the city lights twinkle softly, she keeps her triumphant grin and blinks once. She stays in the same "
    "pose. Night city ambience with a soft wind."),
  "story-cg-act2-belt-blue": dict(seed=509020260908, prompt=STYLE +
    "A woman with dark purple hair tied up with a gold flower ornament and hanging gold tassels, wearing a white shirt, a gold bow tie "
    "and a black-and-gold vest with a black pencil skirt, holds a neatly folded blue martial-arts belt toward the viewer with both "
    "hands under a wooden dojo gate at night, glowing paper lanterns on both sides and cherry blossom petals on the ground. Subtle "
    "ambient motion only: petals drift slowly down, the paper lanterns glow and flicker warmly, loose hair strands and the gold "
    "tassels sway gently, distant garden lights shimmer. She keeps her gentle smile and blinks once slowly. Quiet night breeze."),
  "vivian-scene-lv5": dict(seed=509020260909, prompt=STYLE +
    "A woman with short dark navy hair and teal eyes, wearing a long black cloak with a tall teal stand-up collar, silver trim and "
    "hanging chains, glances back over her shoulder at the viewer with one eye closed in a wink while holding an ornate silver "
    "masquerade mask on a stick; she stands in a theatre dressing room in front of a lit vanity mirror with round bulbs, playing "
    "cards tucked into the mirror frame and posters on the wall, her reflection visible in the mirror. Subtle ambient motion only: "
    "the vanity bulbs flicker warmly, the playing cards on the mirror frame flutter very slightly, loose hair strands sway, the "
    "chains on her cloak glint, dust motes drift in the warm light, she keeps her wink and faint smirk with her lower face tucked "
    "into the collar. The mirror reflection stays consistent. Quiet backstage ambience."),
}

def build(cid, spec, tag):
    return {"prompt": {
      "1": {"class_type": "LoadImage", "inputs": {"image": f"pd-{cid}.png"}},
      "2": {"class_type": "UNETLoader", "inputs": {"unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors", "weight_dtype": "default"}},
      "3": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["2", 0], "lora_name": "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors", "strength_model": 1.0}},
      "4": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default"}},
      "5": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"}},
      "7": {"class_type": "MiniMaxH3ImageToVideo", "inputs": {"clip": ["4", 0], "vae": ["5", 0], "prompt": spec["prompt"], "width": W, "height": H, "length": LENGTH, "first_frame": ["1", 0], "last_frame": ["1", 0]}},
      "8": {"class_type": "BasicGuider", "inputs": {"model": ["3", 0], "conditioning": ["7", 0]}},
      "9": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
      "10": {"class_type": "BasicScheduler", "inputs": {"model": ["3", 0], "scheduler": "simple", "steps": STEPS, "denoise": 1.0}},
      "11": {"class_type": "RandomNoise", "inputs": {"noise_seed": spec["seed"]}},
      "12": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["11", 0], "guider": ["8", 0], "sampler": ["9", 0], "sigmas": ["10", 0], "latent_image": ["7", 1]}},
      "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["5", 0]}},
      "15": {"class_type": "CreateVideo", "inputs": {"images": ["13", 0], "fps": 24.0, "color_space": "sRGB", "bit_depth": "auto"}},
      "16": {"class_type": "SaveVideo", "inputs": {"video": ["15", 0], "format": "mp4", "format.codec": "h264", "format.codec.encoding": "re-encode", "format.codec.encoding.crf": 14.0, "filename_prefix": f"poker-doku/{cid}-{tag}"}},
    }}

def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))

def get(path):
    return json.load(urllib.request.urlopen(API + path, timeout=30))

def run(cid, tag):
    spec = CLIPS[cid]
    payload = build(cid, spec, tag)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, f"{cid}-{tag}-api.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    r = post("/prompt", payload)
    if "prompt_id" not in r:
        print("SUBMIT FAILED", json.dumps(r, ensure_ascii=False)[:2000], flush=True); return None
    pid = r["prompt_id"]; t0 = time.time()
    print(f"[{time.strftime('%H:%M:%S')}] {cid} queued {pid} (len={LENGTH}, {W}x{H}, steps={STEPS})", flush=True)
    last_note = 0
    while True:
        time.sleep(5)
        try:
            h = get(f"/history/{pid}")
        except Exception as error:  # 일시적 API 오류는 다음 폴링에서 재시도 (2026-09-04: 폴링이 멈춰 배치가 끊긴 적 있음)
            print(f"  … {cid} poll error: {error}", flush=True); continue
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error" or any(m[0] == "execution_error" for m in st.get("messages", [])):
                print(f"[{time.strftime('%H:%M:%S')}] {cid} ERROR", json.dumps(st, ensure_ascii=False)[:3000], flush=True); return None
            if st.get("completed"):
                el = time.time() - t0
                files = sorted(glob.glob(os.path.join(OUT_DIR, f"{cid}-{tag}*.mp4")), key=os.path.getmtime)
                print(f"[{time.strftime('%H:%M:%S')}] {cid} DONE in {el:.0f}s -> {files[-1] if files else '??'}", flush=True)
                return files[-1] if files else None
        el = int(time.time() - t0)
        if el - last_note >= 30:
            last_note = el; print(f"  … {cid} running {el}s", flush=True)
        if el > 900:
            print(f"[{time.strftime('%H:%M:%S')}] {cid} TIMEOUT after {el}s", flush=True); return None

if __name__ == "__main__":
    tag = sys.argv[1] if len(sys.argv) > 1 else "v1"
    ids = sys.argv[2:] or list(CLIPS)
    for cid in ids:
        run(cid, tag)
    print("ALL DONE", flush=True)
