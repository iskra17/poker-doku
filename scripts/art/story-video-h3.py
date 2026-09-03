"""컷신 영상 생성기 — MiniMax H3 fl2va, first_frame = last_frame = CG(이음새 없는 루프). 절차는 scripts/art/story-video.md.

사용: python scripts/art/story-video-h3.py <tag> [cgId ...]   (ComfyUI가 127.0.0.1:8188에 떠 있어야 한다)
입력: D:/AI-Image-Video/input/pd-<cgId>.png  출력: D:/AI-Image-Video/output/poker-doku/<cgId>-<tag>_0000N_.mp4
"""
import json, sys, time, urllib.request, glob, os
API = "http://127.0.0.1:8188"
OUT_DIR = r"D:\AI-Image-Video\output\poker-doku"
W, H = 768, 1152
LENGTH = int(os.environ.get("H3_LENGTH", "107"))  # 17k+5 grid @24fps: 90=3.75s, 107=4.46s, 124=5.17s
SEED_OFFSET = int(os.environ.get("H3_SEED_OFFSET", "0"))  # 재생성 시 CLIPS seed에 더한다 (예: H3_SEED_OFFSET=1000 … v2)
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
  # --- 2026-09-04 3차 배치: 인연 씬 22 + 챕터 씬 CG 12 (id 규약: 인연 '<character>-scene-lv<N>', 씬 CG 'scene-<SceneCgId>') ---
  # 사쿠라 — 짧은 핑크 보브, 흰 꽃 머리핀, 핑크 눈
  "sakura-scene-lv10": dict(seed=509020260910, prompt=STYLE +
    "A shy girl with short pink bob hair and a white flower hairpin, wearing a cream cardigan over a white blouse with a pink ribbon "
    "and a long pale pink skirt, kneels on a wooden engawa veranda of a ryokan at night and holds out a small cup of green tea toward "
    "the viewer with a gentle smile; a tea tray with a teapot and an open case of poker chips sit beside her, paper lanterns glow and a "
    "dark garden with stone lanterns lies behind. Subtle ambient motion only: thin steam rises from the teacup and teapot, the lantern "
    "light flickers warmly, loose hair strands sway slightly, she blinks slowly and keeps her gentle smile, the cup stays steady in her "
    "hand. Quiet night garden ambience with crickets."),
  "sakura-scene-lv15": dict(seed=509020260911, prompt=STYLE +
    "A girl with short pink bob hair and a white flower hairpin, wearing a pink floral yukata with a large deep-pink obi bow, stands on a "
    "night festival street lined with glowing red paper lanterns and food stalls, looking back over her shoulder at the viewer with a "
    "joyful open-mouth smile while holding a clear plastic bag of water with a small orange goldfish inside. Subtle ambient motion only: "
    "the goldfish swims gently inside the bag, the strings of lanterns sway and flicker, distant festival lights twinkle as soft bokeh, "
    "her hair and the yukata sleeves sway in a light breeze, she blinks once and keeps her smile. Distant festival crowd murmur."),
  "sakura-scene-lv20": dict(seed=509020260912, prompt=STYLE +
    "A girl with short pink bob hair and a white flower hairpin, wearing a cream cardigan over a white blouse with a pink ribbon and a "
    "pink plaid pleated skirt, stands on a park path lined with cherry trees in full bloom under a bright blue sky, hands clasped behind "
    "her back, smiling brightly at the viewer. Subtle ambient motion only: countless cherry blossom petals drift and fall everywhere, the "
    "blossom branches sway very slightly, sunlight shimmers through the petals, her hair and skirt hem sway in a soft breeze, she blinks "
    "once and keeps her bright smile. Soft spring breeze."),
  # 아라 — 긴 붉은 트윈테일·검은 리본, 검은 크롭 재킷(금 드래곤 자수)·붉은 크롭탑
  "ara-scene-lv5": dict(seed=509020260913, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons and sharp red eyes, wearing a black cropped jacket with gold trim and a "
    "gold dragon emblem over a red crop top, red gaming headphones around her neck, sits at her gaming desk in a neon-lit gaming room "
    "with RGB PC towers, monitors showing red dragon artwork and trophies on a shelf; she balances a poker chip on her raised index "
    "finger with a smug grin; a notebook full of scribbles, poker chips, playing cards and a black tumbler lie on the desk. Subtle "
    "ambient motion only: the RGB lights on the PC and desk slowly pulse and shift color, the monitor glow flickers faintly, the chip "
    "on her fingertip glints, her twin tails sway slightly, she blinks once and keeps her grin. Quiet hum of PC fans."),
  "ara-scene-lv10": dict(seed=509020260914, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons and red eyes, wearing a black cropped jacket with gold trim and a gold "
    "dragon emblem over a red top and black shorts, stands on an esports arena stage under bright spotlights with a cheering crowd in the "
    "background, reaching her open palm toward the viewer for a high five with a wide grin; a trophy and poker chips sit on a table "
    "behind her, confetti fills the air. Subtle ambient motion only: colorful confetti drifts and falls slowly, the stage lights sparkle "
    "and pulse gently, the crowd lights twinkle, her twin tails sway, she blinks once and keeps her grin; her outstretched hand stays in "
    "place. Arena crowd cheering in the distance."),
  "ara-scene-lv15": dict(seed=509020260915, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons and red eyes, wearing a black cropped jacket with gold trim over a red "
    "crop top and a black pleated skirt, stands at a night street food market and holds out a skewer of grilled meat toward the viewer "
    "with a blushing pout, one hand raised near her cheek; steaming food stalls with red lanterns and city lights glow behind her. "
    "Subtle ambient motion only: steam rises from the food stalls and the skewer, the red lantern flickers, distant city lights twinkle "
    "as soft bokeh, her twin tails sway in a light breeze, she blinks once and keeps her pout; the skewer stays steady. Night market "
    "ambience with sizzling sounds."),
  "ara-scene-lv20": dict(seed=509020260916, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons and red eyes, wearing a black cropped jacket with gold trim and a gold "
    "dragon emblem over a red crop top and black pants with a belt, stands on a rooftop at night in front of a glowing city skyline, "
    "looking at the viewer with a calm soft smile. Subtle ambient motion only: her long twin tails and loose hair strands stream gently "
    "in the night wind, the city lights twinkle softly, thin clouds drift very slowly, she blinks once and keeps her soft smile. Quiet "
    "night wind."),
  # 하나 — 긴 보라 머리·옆 땋은 머리, 얇은 무테 안경, 다크 퍼플 수트·흰 셔츠
  "hana-scene-lv5": dict(seed=509020260917, prompt=STYLE +
    "A calm woman with long purple hair with a small side braid, thin rimless glasses and purple eyes, wearing a dark purple suit over a "
    "white shirt, stands beside a large whiteboard densely covered with handwritten poker math notes and diagrams in a bright classroom, "
    "holding a marker and looking at the viewer with a small confident smile. Subtle ambient motion only: the handwriting and diagrams "
    "on the whiteboard stay perfectly fixed and unchanged, soft daylight from the window shifts very slightly, loose hair strands sway, "
    "her glasses catch a faint glint, she blinks once and keeps her small smile. Quiet classroom ambience."),
  "hana-scene-lv10": dict(seed=509020260918, prompt=STYLE +
    "A calm woman with long purple hair with a small side braid, thin rimless glasses and purple eyes, wearing a dark purple suit over a "
    "white shirt, sits at a library desk at night under a warm table lamp, pointing with a pen at an open notebook full of handwritten "
    "poker notes; two paper coffee cups, a stack of poker books and tall bookshelves surround her. Subtle ambient motion only: the "
    "handwriting in the notebook stays perfectly fixed, thin steam rises from the coffee cups, the lamp glow flickers warmly, loose "
    "hair strands sway slightly, she blinks once and keeps her calm expression; the pen stays in place. Quiet library ambience."),
  "hana-scene-lv15": dict(seed=509020260919, prompt=STYLE +
    "A calm woman with long loose purple hair, thin rimless glasses and purple eyes, wearing a dark purple suit over a white shirt with a "
    "thin necklace, stands in an office at sunset with orange light streaming through the window blinds, one hand running through her "
    "long hair, a soft quiet expression; a whiteboard and a desk with notebooks behind her. Subtle ambient motion only: the sunset light "
    "shifts and shimmers softly, long hair strands drift and settle, dust motes float in the warm light, her glasses glint faintly, she "
    "blinks once slowly and keeps her soft expression. Quiet evening office ambience."),
  "hana-scene-lv20": dict(seed=509020260920, prompt=STYLE +
    "A calm woman with long purple hair with a small side braid, thin rimless glasses and purple eyes, wearing a dark purple suit over a "
    "white shirt, stands on a rooftop at night under a sky full of stars and the Milky Way, holding a single playing card with a red "
    "heart to her chest, smiling gently at the viewer; city lights glow below the railing. Subtle ambient motion only: the stars twinkle "
    "softly, the city lights below shimmer, loose hair strands sway in a light breeze, her glasses glint faintly, she blinks once and "
    "keeps her gentle smile; the card stays perfectly still. Quiet night breeze."),
  # 클로이 — 하늘색 웨이브 머리·눈꽃 머리핀·안테나 머리카락, 파란 눈, 파란·흰 후디(별 패치)
  "chloe-scene-lv5": dict(seed=509020260921, prompt=STYLE +
    "A cheerful girl with fluffy light sky-blue wavy hair with snowflake hair clips and a single upright strand on top, big blue eyes, "
    "wearing a blue-and-white hoodie with star patches, sits at her streaming desk with a ring light, a microphone on a boom arm, an RGB "
    "keyboard, plush toys and glowing chat panels, making a double peace sign with a huge open-mouth smile; a snowman plush and a mug of "
    "cocoa with marshmallows sit in front. Subtle ambient motion only: the RGB keyboard and desk lights slowly shift colors, the ring "
    "light glows steadily with a soft pulse, thin steam rises from the cocoa, her fluffy hair sways slightly, she blinks once and keeps "
    "her smile; her hands stay in the peace sign. Cozy streaming room ambience."),
  "chloe-scene-lv10": dict(seed=509020260922, prompt=STYLE +
    "A cheerful girl with fluffy light sky-blue wavy hair with snowflake hair clips and a single upright strand on top, big blue eyes, "
    "wearing a blue-and-white hoodie with star patches, takes a close-up selfie with her arm stretched toward the camera, beaming with an "
    "open-mouth smile, in a poker room with green felt tables, chips and warm bokeh lights behind her. Subtle ambient motion only: the "
    "warm bokeh lights twinkle, tiny sparkles glitter around her, her fluffy hair sways slightly, she blinks once and keeps her beaming "
    "smile; her outstretched arm stays in place. Lively poker room ambience."),
  "chloe-scene-lv15": dict(seed=509020260923, prompt=STYLE +
    "A cheerful girl with fluffy light sky-blue wavy hair with snowflake hair clips and a single upright strand on top, big blue eyes, "
    "wearing a blue-and-white hoodie with star patches, sits at a sunny cafe table by a window, stirring a mug of hot cocoa topped with "
    "marshmallows with a spoon and smiling brightly at the viewer; a plate of cookies and a small vase with a green sprig sit on the "
    "table. Subtle ambient motion only: thin steam rises from the cocoa, warm sunlight shimmers through the window, her fluffy hair sways "
    "slightly, she blinks once and keeps her smile; the spoon barely moves. Quiet cafe ambience."),
  "chloe-scene-lv20": dict(seed=509020260924, prompt=STYLE +
    "A cheerful girl with fluffy light sky-blue wavy hair with snowflake hair clips and a single upright strand on top, big blue eyes, "
    "wearing a blue-and-white hoodie with star patches and blue shorts, stands on a glittering casino stage with both arms spread wide "
    "toward the viewer and a huge open-mouth smile, as golden confetti showers around her; poker chips and cards lie on the stage. "
    "Subtle ambient motion only: gold confetti drifts and falls slowly while glittering, the stage lights sparkle, her fluffy hair sways, "
    "she blinks once and keeps her smile; her arms stay spread in place. Celebration ambience with soft cheers."),
  # 비비안 — 짧은 다크 네이비 머리, 틸 눈, 눈 밑 점, 틸 귀걸이, 검은 터틀넥·틸 스탠드 카라 클록·은 가면 브로치·체인
  "vivian-scene-lv10": dict(seed=509020260925, prompt=STYLE +
    "An elegant woman with short dark navy hair, teal eyes, a small mole under one eye and teal drop earrings, wearing a black turtleneck "
    "and a black cloak with a tall teal-patterned stand-up collar, a silver twin-mask brooch and hanging chains, sits in a red velvet opera "
    "box seat holding an ornate silver masquerade mask on a stick beside her face, smiling faintly at the viewer; a grand theatre with a "
    "chandelier and an audience below lies behind her. Subtle ambient motion only: the chandelier crystals glint and the warm theatre "
    "lights flicker softly, the chains on her cloak glint, loose hair strands sway slightly, she blinks once slowly and keeps her faint "
    "smile; the mask stays in place. Distant orchestra tuning."),
  "vivian-scene-lv15": dict(seed=509020260926, prompt=STYLE +
    "An elegant woman with short dark navy hair, teal eyes, a small mole under one eye and teal drop earrings, wearing a black turtleneck "
    "dress with a belt and a black cloak with a tall teal-patterned stand-up collar, a silver twin-mask brooch and hanging chains, stands "
    "on a dark empty stage under a single bright spotlight, holding an ornate silver masquerade mask on a stick lowered beside her face, "
    "smiling gently at the viewer. Subtle ambient motion only: dust motes drift slowly through the spotlight beam, the spotlight intensity "
    "breathes very softly, the hem of her cloak sways slightly, the chains glint, loose hair strands sway, she blinks once slowly and keeps "
    "her gentle smile; the mask stays in place. Quiet empty theatre ambience."),
  "vivian-scene-lv20": dict(seed=509020260927, prompt=STYLE +
    "An elegant woman with short dark navy hair, teal eyes, a small mole under one eye and teal drop earrings, wearing a black turtleneck "
    "dress with a belt and a black cloak with a tall teal-patterned stand-up collar, a silver twin-mask brooch and hanging chains, stands "
    "on a theatre stage between red velvet curtains and holds out a single red rose toward the viewer with a warm smile; footlights glow "
    "and red rose petals lie scattered on the stage floor, the dark theatre seats behind her. Subtle ambient motion only: a few rose petals "
    "drift slowly down, the footlights flicker warmly, the red curtains sway very slightly, the chains glint, loose hair strands sway, she "
    "blinks once and keeps her smile; the rose stays steady. Quiet theatre ambience with a soft final applause far away."),
  # 엘레나 — 아주 긴 은백색 머리, 회청색 눈, 검은 코트/수트·연회색 넥타이, 은 귀걸이
  "elena-scene-lv5": dict(seed=509020260928, prompt=STYLE +
    "A cool composed woman with very long straight silver-white hair, pale grey-blue eyes and small silver earrings, wearing a long black "
    "belted coat, stands on a snowy Moscow street at dusk and looks back over her shoulder at the viewer with a calm expression, her "
    "breath visible in the cold air; a glowing street lamp, snow-covered buildings and a red-brick Kremlin tower with a clock stand "
    "behind her under heavy clouds. Subtle ambient motion only: snow falls gently, a soft puff of breath mist drifts from her lips and "
    "fades, the street lamp glows warmly, her long hair sways in the cold wind, she blinks once slowly and keeps her calm expression. "
    "Quiet snowy street with a cold wind."),
  "elena-scene-lv10": dict(seed=509020260929, prompt=STYLE +
    "A cool composed woman with very long straight silver-white hair, pale grey-blue eyes and small silver earrings, wearing a black suit "
    "jacket over a white shirt with a pale grey tie, sits at a dark wooden cafe table at night and slides a cup of black coffee toward the "
    "viewer with one hand, looking at the viewer with a calm neutral expression; a second coffee cup sits on the table, a black coat is "
    "draped over her chair, rain streaks the window behind her and a bar with bottles glows warmly. Subtle ambient motion only: thin steam "
    "rises from both coffee cups, rain drops run down the window, the warm lamp light flickers softly, her long hair sways slightly, she "
    "blinks once slowly and keeps her calm expression; her hand and the cup stay in place. Quiet cafe with rain on the window."),
  "elena-scene-lv15": dict(seed=509020260930, prompt=STYLE +
    "A cool composed woman with very long straight silver-white hair, pale grey-blue eyes and small silver earrings, wearing a long black "
    "coat over a black suit with a white shirt and a pale grey tie, stands with both hands in her coat pockets beside a large window "
    "covered in frost patterns at night, looking at the viewer with a calm expression; a warm table lamp and a framed photo sit beside "
    "her, city lights glow beyond the frosted glass. Subtle ambient motion only: the frost patterns on the window glitter faintly, snow "
    "falls slowly outside, the lamp glow flickers softly, her long hair sways slightly, she blinks once slowly and keeps her calm "
    "expression. Quiet winter night room."),
  "elena-scene-lv20": dict(seed=509020260931, prompt=STYLE +
    "A cool composed woman with very long straight silver-white hair, pale grey-blue eyes and small silver earrings, wearing a long black "
    "coat over a black suit with a white shirt and a pale grey tie, stands with both hands in her coat pockets on a snowy riverside "
    "promenade at night beside a glowing old street lamp, looking at the viewer with a small gentle smile as snow falls; distant lamps "
    "and a bridge glow across the river. Subtle ambient motion only: snowflakes fall gently and a few land on her coat and hair, the "
    "street lamps glow warmly, her long hair sways in a light wind, she blinks once slowly and keeps her small smile. Quiet snowfall."),
  # 씬 CG — 챕터 프롤로그/에필로그
  "scene-act1-ch01-prologue": dict(seed=509020260932, prompt=STYLE +
    "A woman with dark purple hair tied up with a gold flower ornament and hanging gold tassels, amber eyes, wearing a white shirt, a "
    "gold bow tie and a black-and-gold embroidered vest with black trousers, stands inside an open wooden dojo gate in soft golden morning "
    "light, waving one hand at the viewer with a warm welcoming smile; cherry blossom trees in full bloom and a stone path lead to the "
    "dojo behind her. Subtle ambient motion only: cherry blossom petals drift slowly through the air, loose hair strands and the gold "
    "tassels sway gently, the morning light shimmers softly, she blinks once and keeps her welcoming smile; her waving hand stays raised "
    "in place. Quiet morning breeze with birdsong."),
  "scene-act1-ch01-epilogue": dict(seed=509020260933, prompt=STYLE +
    "No people. A wooden engawa veranda at night facing a Japanese garden: two playing cards lie face down side by side on the wooden "
    "floor beside a small ceramic teacup of steaming tea and a glowing paper lantern, scattered cherry petals on the boards; beyond the "
    "veranda a koi pond reflects a full moon, stone lanterns glow and cherry trees bloom under the night sky. Subtle ambient motion only: "
    "thin steam rises from the teacup, the paper lantern flickers warmly, koi fish swim slowly beneath the pond surface, gentle ripples "
    "move across the moon reflection, cherry petals drift slowly down. The cards stay perfectly still. Quiet night garden with crickets "
    "and soft water sounds."),
  "scene-act1-ch02-prologue": dict(seed=509020260934, prompt=STYLE +
    "A shy girl with short pink bob hair and a white flower hairpin, pink eyes, wearing a cream cardigan over a white blouse with a pink "
    "ribbon, sits across a teal-felt poker table in a warm lantern-lit dojo room, clutching two pink playing cards to her chest with both "
    "hands, blushing, wide anxious but determined eyes; poker chips and two face-down cards lie on the felt. Subtle ambient motion only: "
    "cherry blossom petals drift slowly through the room, the lantern light flickers warmly, her hair sways slightly, the cards in her "
    "hands tremble very slightly, she blinks once and keeps her anxious expression. Quiet room ambience."),
  "scene-act1-ch02-epilogue": dict(seed=509020260935, prompt=STYLE +
    "A girl with short pink bob hair and a white flower hairpin, wearing a cream cardigan over a white blouse with a pink ribbon, a grey "
    "pleated skirt, white socks and brown loafers, stands full-body on a stone path in a Japanese garden at night with her hands clasped "
    "behind her back, eyes closed and a calm gentle smile; a full moon, blooming cherry trees, glowing stone lanterns and a koi pond with "
    "orange koi surround her. Subtle ambient motion only: cherry petals fall gently, koi swim slowly in the pond and ripples spread, the "
    "stone lanterns flicker warmly, her hair and skirt hem sway in a light breeze; her eyes stay closed and her smile stays. Quiet night "
    "garden with crickets."),
  "scene-act1-ch03-prologue": dict(seed=509020260936, prompt=STYLE +
    "A calm woman with long purple hair with a small side braid, thin glasses and purple eyes, wearing a dark purple suit over a white "
    "shirt, stands beside a whiteboard with abstract purple bar charts in a violet-lit study, one hand adjusting her glasses and the other "
    "resting on the whiteboard, with a composed smile; in the foreground a small teal baby dragon with a cream egg-shell hat, golden belly "
    "scales and tiny wings sits on the desk puffing a small orange flame from its mouth with a cheeky grin, poker chips and cards "
    "scattered around, a brass desk lamp and a globe nearby. Subtle ambient motion only: the small flame flickers and dances, the "
    "dragon's tiny wings twitch and it blinks, the desk lamp glow flickers softly, her hair sways slightly, she blinks once and keeps "
    "her smile; the whiteboard charts stay perfectly fixed. Quiet study ambience with a soft crackle of the flame."),
  "scene-act1-ch03-epilogue": dict(seed=509020260937, prompt=STYLE +
    "A calm woman with long purple hair with a small side braid, thin glasses, wearing a dark purple suit, seen from behind and slightly "
    "to the side, draws a straight line across a whiteboard of abstract pie and line charts with a marker, in a study at sunset with "
    "orange light streaming through window blinds; in the foreground a small teal baby dragon with a cream egg-shell hat and tiny wings "
    "sits on the desk watching her, beside a steaming cup of coffee, poker chips and cards. Subtle ambient motion only: the sunset light "
    "shifts and shimmers softly through the blinds, thin steam rises from the coffee cup, the dragon's wings twitch and its tail sways "
    "slowly, her long hair sways slightly; the marker and the charts stay fixed. Quiet evening study ambience."),
  "scene-act2-ch04-prologue": dict(seed=509020260938, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons and sharp red eyes, wearing a black cropped jacket with gold trim and a "
    "gold dragon emblem over a red crop top and black pants, leans forward across a green felt poker table in a dojo at dusk, one hand "
    "extended toward the viewer having just flicked a red poker chip that hangs in the air in front of her, grinning with a challenging "
    "look; chips and playing cards lie on the felt, a paper lantern glows above and a sunset sky shows through the shoji windows. Subtle "
    "ambient motion only: the flicked poker chip hovers and spins slowly in place, the lantern light flickers warmly, the sunset clouds "
    "glow softly, her twin tails sway slightly, she blinks once and keeps her grin; her hand stays extended. Quiet dojo ambience."),
  "scene-act2-ch04-epilogue": dict(seed=509020260939, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons and red eyes, wearing a black cropped jacket with gold trim and a gold "
    "dragon emblem over a red crop top and black pants with a belt, stands on a dojo rooftop at night with a glowing city skyline and "
    "pagoda roofs behind her, holding out a clenched fist toward the viewer for a fist bump, looking slightly away with a blush and a "
    "small proud smile. Subtle ambient motion only: her twin tails and loose hair strands sway in the night wind, the city lights "
    "twinkle, a few tiny ember-like sparks drift through the air, thin clouds drift slowly, she blinks once and keeps her smile; her fist "
    "stays in place. Quiet night wind."),
  "scene-act2-ch05-prologue": dict(seed=509020260940, prompt=STYLE +
    "A cheerful girl with fluffy light sky-blue wavy hair with snowflake hair clips and a single upright strand on top, big blue eyes, "
    "wearing a blue-and-white hoodie with star patches, sits at a green felt poker table in a dojo with a smartphone on a small tripod "
    "and a glowing ring light on one side and a microphone on the other, making a peace sign beside her eye with a big open-mouth smile; "
    "stacks of colorful poker chips and playing cards lie on the felt, purple neon lanterns glow behind. Subtle ambient motion only: the "
    "ring light glows with a soft pulse, tiny sparkles glitter in the air, the neon lanterns flicker faintly, her fluffy hair sways "
    "slightly, she blinks once and keeps her smile; her peace-sign hand stays in place. Quiet dojo ambience."),
  "scene-act2-ch05-epilogue": dict(seed=509020260941, prompt=STYLE +
    "A cheerful girl with fluffy light sky-blue wavy hair with snowflake hair clips and a single upright strand on top, big blue eyes, "
    "wearing a blue-and-white hoodie with star patches and white shorts, standing barefoot full-body in a dojo room at sunset with one "
    "hand on her hip and the other arm stretched out proudly presenting a very tall tower of stacked poker chips on a round table, "
    "beaming with a huge smile; warm sunset light streams through the shoji windows onto tatami mats. Subtle ambient motion only: the "
    "sunset light shimmers softly, dust motes drift in the light, her fluffy hair sways slightly, she blinks once and keeps her smile; "
    "the chip tower stays perfectly still and balanced. Quiet evening dojo ambience."),
  "scene-act2-ch06-prologue": dict(seed=509020260942, prompt=STYLE +
    "A large round black-and-white penguin creature with an ice-crystal crest and a pale blue bow tie sits at a blue felt poker table in "
    "a dim dojo with a frosty aura and small floating ice crystals around it, neat stacks of blue chips in front of it and community cards "
    "on the felt; beside the table stands a girl with long red twin-tail hair tied with black ribbons and red eyes, wearing a black "
    "cropped jacket with gold trim over a red crop top and black shorts, arms crossed with a serious focused look; cold blue light on the "
    "penguin side, warm orange lantern light on her side. Subtle ambient motion only: the ice crystals float and glitter slowly, frost "
    "sparkles shimmer around the penguin, the lantern light flickers warmly, the penguin blinks and its bow tie twitches faintly, her "
    "twin tails sway slightly, she blinks once and keeps her serious look. Tense quiet room ambience."),
  "scene-act2-ch06-epilogue": dict(seed=509020260943, prompt=STYLE +
    "A girl with long red twin-tail hair tied with black ribbons and red eyes, wearing a black cropped jacket with gold trim and a gold "
    "dragon emblem over a red top and black shorts with a belt, stands in front of a wooden dojo gate at night under glowing paper "
    "lanterns with her hands behind her back, looking away to the side with a blush and a small honest smile; cherry blossom petals drift "
    "and a violet night sky shows above. Subtle ambient motion only: cherry petals drift slowly down, the paper lanterns flicker warmly, "
    "her twin tails and loose hair strands sway in a light breeze, she blinks once and keeps her small smile. Quiet night breeze."),
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
      "11": {"class_type": "RandomNoise", "inputs": {"noise_seed": spec["seed"] + SEED_OFFSET}},
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
