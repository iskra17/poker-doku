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
    while True:
        time.sleep(5)
        h = get(f"/history/{pid}")
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
        if el % 30 == 0: print(f"  … {cid} running {el}s", flush=True)

if __name__ == "__main__":
    tag = sys.argv[1] if len(sys.argv) > 1 else "v1"
    ids = sys.argv[2:] or list(CLIPS)
    for cid in ids:
        run(cid, tag)
    print("ALL DONE", flush=True)
