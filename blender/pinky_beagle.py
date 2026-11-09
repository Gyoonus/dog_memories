# -*- coding: utf-8 -*-
"""
pinky_beagle.py  --  핑키(Pinky) 비글 3D 캐릭터 생성 스크립트 (Blender 4.x)

실행 방법 (둘 다 가능):
    blender -b -P pinky_beagle.py -- --out renders --views ref --res 1024 --samples 128
    /opt/bpyenv/bin/python pinky_beagle.py --out renders --views all --save-blend pinky.blend --export-glb pinky.glb

옵션:
    --out <dir>          렌더 출력 폴더 (기본: ./renders)
    --res <px>           가로 해상도 (세로는 3:2 비율로 자동, 기본 768)
    --samples <n>        Cycles 샘플 수 (기본 64)
    --pose stand|sit     --views none 일 때 저장/내보내기 포즈 (기본 stand)
    --views ref|turntable|all|none   렌더할 뷰 세트 (기본 ref)
    --save-blend <path>  .blend 저장
    --export-glb <path>  glTF(GLB) 내보내기 (파티클 털은 제외됨 - 버텍스 컬러로 삼색 무늬 유지)
    --no-fur             털 파티클 끄기 (빠른 WIP 렌더용)
    --fur-scale <f>      털 개수 배율 (기본 1.0)
    --frames <n>         턴테이블 프레임 수 (기본 12)

구조:
    1. 비율 상수 (PROPORTIONS)      - 레퍼런스 사진에서 측정한 체형 수치 (m 단위, 기갑 높이 0.36 m)
    2. 스켈레톤 정의 (JOINTS/BONES)  - 서있는 자세의 관절 위치, 뼈 계층
    3. 메타볼 → 메쉬 → 복셀 리메시  - 하나로 이어진 유기적 바디 메쉬 (구/원기둥 조립이 아님)
    4. 버텍스 컬러(삼색 무늬) + 뼈 가중치 (numpy)
    5. 아마추어 리깅, 귀/눈/코/목걸이/메달
    6. 재질, 털(파티클 헤어), 조명, 그림자 캐처 바닥, 카메라
    7. 포즈(stand / sit) + 레퍼런스 4뷰 / 턴테이블 렌더
"""
import sys, os, math, argparse, time
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

# ----------------------------------------------------------------------------
# 0. 인자 파싱
# ----------------------------------------------------------------------------
def parse_args():
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    elif argv and argv[0].endswith('pinky_beagle.py'):
        argv = argv[1:]
    else:
        argv = [a for a in argv[1:] if not a.endswith('.py')]
    p = argparse.ArgumentParser(description='Pinky the beagle - Blender builder')
    p.add_argument('--out', default='renders')
    p.add_argument('--res', type=int, default=768)
    p.add_argument('--samples', type=int, default=64)
    p.add_argument('--pose', default='stand', choices=['stand', 'sit'])
    p.add_argument('--views', default='ref', choices=['ref', 'turntable', 'all', 'none'])
    p.add_argument('--save-blend', default=None)
    p.add_argument('--export-glb', default=None)
    p.add_argument('--no-fur', action='store_true')
    p.add_argument('--fur-scale', type=float, default=1.0)
    p.add_argument('--frames', type=int, default=12)
    p.add_argument('--only', default=None, help='comma list of ref views to render e.g. v1,v4')
    return p.parse_args(argv)

ARGS = parse_args()

# ----------------------------------------------------------------------------
# 1. 비율 상수  (좌표계: +X = 앞(코 방향), +Y = 왼쪽, +Z = 위, 바닥 z = 0, 단위 m)
#    레퍼런스에서 측정: 기갑 높이 0.36, 몸길이(가슴~엉덩이) 0.45 (=1.25H), 다리(팔꿈치~바닥) 0.17,
#    머리 길이 0.17, 두개골 폭 0.13, 귀 길이 0.14, 눈 지름 0.025, 눈 간격 0.065
# ----------------------------------------------------------------------------
P = dict(
    withers_z=0.355,        # 기갑(어깨) 높이
    rump_z=0.335,           # 엉덩이 위 척추 높이
    chest_bottom_z=0.155,   # 가슴 바닥(흉골) 높이  -> 가슴 깊이 0.20 (깊은 가슴)
    body_front_x=0.355,     # 가슴 앞점
    body_rear_x=-0.09,      # 엉덩이 뒷점
    chest_half_w=0.088,     # 가슴 반폭
    rump_half_w=0.080,      # 엉덩이 반폭
    neck_len=0.12,
    head_len=0.17,          # 후두부~코끝
    skull_half_w=0.065,     # 두개골 반폭 (넓고 둥근 두상)
    muzzle_len=0.075,       # 주둥이 길이
    muzzle_half_w=0.036,
    eye_r=0.016,            # 안구 반지름 (큰 눈, 보이는 지름 약 2.8 cm)
    eye_sep=0.066,          # 눈 간격 (중심-중심)
    ear_len=0.145,          # 귀 길이 (턱 아래까지)
    ear_half_w=0.046,       # 귀 반폭
    tail_len=0.20,
    leg_r_upper=0.036,      # 앞다리 윗부분 반지름
    leg_r_lower=0.031,      # 앞다리 아랫부분 반지름
    thigh_r=0.052,          # 허벅지 반지름
    shin_r=0.030,
    paw_len=0.06, paw_half_w=0.031, paw_h=0.024,
)

# 피부/털 색 (sRGB 0..1, 레퍼런스의 빛바랜 저채도 톤)
COL = dict(
    white=(0.92, 0.88, 0.81),
    tan=(0.68, 0.57, 0.45),        # 황갈색(빛바랜)
    tan_grey=(0.60, 0.54, 0.47),   # 회색기 도는 황갈색 (귀/얼굴 옆)
    saddle=(0.11, 0.10, 0.095),    # 등의 검정(차콜)
    saddle_fleck=(0.36, 0.33, 0.29),  # 등의 회색 털 섞임
    rim=(0.20, 0.15, 0.12),        # 눈가 테두리
    lip=(0.18, 0.14, 0.12),
    bg=(0.50, 0.50, 0.515),        # 배경 회색 (sRGB)
)

def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

# ----------------------------------------------------------------------------
# 2. 스켈레톤 (서있는 자세 = 레스트 포즈)
# ----------------------------------------------------------------------------
WZ, RZ = P['withers_z'], P['rump_z']
J = {   # 관절 위치
    'tailbase': (-0.08, 0, RZ - 0.025),
    'hips':     (-0.035, 0, RZ),
    'loin':     (0.09, 0, RZ + 0.005),
    'chest':    (0.20, 0, WZ - 0.005),
    'withers':  (0.29, 0, WZ),
    'neck_top': (0.37, 0, 0.44),
    'head_end': (0.47, 0, 0.45),
    'nose':     (0.540, 0, 0.412),
    'tail_mid': (-0.16, 0, RZ + 0.005),
    'tail_tip': (-0.235, 0, RZ + 0.04),
}
for s, sgn in (('L', 1), ('R', -1)):
    J['shoulder.' + s] = (0.305, sgn * 0.062, 0.275)
    J['elbow.' + s]    = (0.275, sgn * 0.070, 0.165)
    J['wrist.' + s]    = (0.285, sgn * 0.072, 0.055)
    J['fpaw.' + s]     = (0.335, sgn * 0.074, 0.0)
    J['hip.' + s]      = (-0.03, sgn * 0.058, 0.255)
    J['stifle.' + s]   = (0.03, sgn * 0.068, 0.15)
    J['hock.' + s]     = (-0.025, sgn * 0.070, 0.085)
    J['hpaw.' + s]     = (0.025, sgn * 0.072, 0.0)
    J['ear.' + s]      = (0.412, sgn * 0.060, 0.462)
    J['ear_tip.' + s]  = (0.421, sgn * 0.066, 0.462 - P['ear_len'])

# (뼈 이름, 시작 관절, 끝 관절, 부모)
BONES = [
    ('spine1', 'hips', 'loin', None),
    ('spine2', 'loin', 'chest', 'spine1'),
    ('spine3', 'chest', 'withers', 'spine2'),
    ('neck', 'withers', 'neck_top', 'spine3'),
    ('head', 'neck_top', 'head_end', 'neck'),
    ('tail1', 'tailbase', 'tail_mid', 'spine1'),
    ('tail2', 'tail_mid', 'tail_tip', 'tail1'),
]
for s in 'LR':
    BONES += [
        ('upperarm.' + s, 'shoulder.' + s, 'elbow.' + s, 'spine3'),
        ('forearm.' + s, 'elbow.' + s, 'wrist.' + s, 'upperarm.' + s),
        ('fpaw.' + s, 'wrist.' + s, 'fpaw.' + s, 'forearm.' + s),
        ('thigh.' + s, 'hip.' + s, 'stifle.' + s, 'spine1'),
        ('shin.' + s, 'stifle.' + s, 'hock.' + s, 'thigh.' + s),
        ('hpaw.' + s, 'hock.' + s, 'hpaw.' + s, 'shin.' + s),
        ('ear.' + s, 'ear.' + s, 'ear_tip.' + s, 'head'),
    ]
BONE_PARENT = {b[0]: b[3] for b in BONES}
BONE_HEAD = {b[0]: np.array(J[b[1]], float) for b in BONES}
BONE_TAIL = {b[0]: np.array(J[b[2]], float) for b in BONES}

def V(*a):
    return np.array(a if len(a) == 3 else a[0], dtype=float)

def mix(a, b, t):
    return tuple(np.asarray(a) * (1 - t) + np.asarray(b) * t)

# ----------------------------------------------------------------------------
# 3. 메타볼 바디
# ----------------------------------------------------------------------------
MB_THRESH = 0.6
def vis_frac(stiff):
    """메타볼 요소: 등위면이 radius 의 몇 배에서 생기는지 (가시 반지름 / radius)"""
    return math.sqrt(max(0.0, 1.0 - (MB_THRESH / stiff) ** (1.0 / 3.0)))

ELEMS = []  # dict(bone, co, axes, rot, stiff, neg)

def rot_from_dir(d, up=(0, 0, 1)):
    d = Vector(d).normalized()
    up = Vector(up)
    if abs(d.dot(up.normalized())) > 0.98:
        up = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
    y = up.cross(d).normalized()      # lateral
    z = d.cross(y).normalized()
    m = Matrix((d, y, z)).transposed()  # columns = local axes
    return m.to_quaternion()

def ell(bone, co, axes, d=(1, 0, 0), up=(0, 0, 1), stiff=2.0, neg=False):
    """가시 반축 axes=(along d, lateral, up) 인 타원체 요소 추가"""
    ELEMS.append(dict(bone=bone, co=V(co), axes=V(axes), rot=rot_from_dir(d, up), stiff=stiff, neg=neg))

def limb(bone, p0, p1, r0, r1=None, stiff=2.5, pad=0.6, bulge=1.0):
    """두 관절 사이를 잇는 사지 요소(타원체). r0/r1 = 양 끝 반지름"""
    p0, p1 = V(p0), V(p1)
    r1 = r0 if r1 is None else r1
    d = p1 - p0
    L = np.linalg.norm(d)
    mid = (p0 + p1) / 2
    r = (r0 + r1) / 2
    ell(bone, mid, (L / 2 + pad * r, r * bulge, r), d=tuple(d), stiff=stiff)

def mirror(fn):
    for s, sgn in (('L', 1), ('R', -1)):
        fn(s, sgn)

def build_elements():
    ELEMS.clear()
    # --- 몸통: 깊은 가슴, 긴 허리, 둥근 엉덩이 (여러 타원체가 자연스럽게 융합)
    cz = (WZ + P['chest_bottom_z']) / 2
    ell('spine3', (0.235, 0, cz), (0.135, P['chest_half_w'], (WZ - P['chest_bottom_z']) / 2), d=(1, 0, 0.0))
    ell('spine2', (0.11, 0, cz + 0.005), (0.125, P['chest_half_w'] - 0.012, 0.095))   # 허리 (등선이 곧게)
    ell('spine1', (-0.01, 0, RZ - 0.088), (0.10, P['rump_half_w'], 0.088))
    ell('spine1', (-0.05, 0, RZ - 0.10), (0.055, P['rump_half_w'] - 0.015, 0.068))   # 엉덩이 뒷부분(둔부 경사)
    ell('spine2', (0.10, 0, 0.215), (0.14, 0.07, 0.055))                              # 배 채우기
    ell('spine3', (0.33, 0, 0.245), (0.05, 0.06, 0.06), stiff=2.5)                    # 가슴 앞(흉골) 돌출
    mirror(lambda s, g: ell('spine3', (0.27, g * 0.055, 0.285), (0.065, 0.035, 0.065), d=(0.3, 0, -1)))  # 견갑
    # --- 목 (기갑에서 비스듬히 올라가 머리 뒤로 연결, 목 앞쪽은 목젖/가슴으로 이어짐)
    nd = tuple(V(J['neck_top']) - V(J['withers']))
    ell('neck', mix(J['withers'], J['neck_top'], 0.5), (0.075, 0.052, 0.055), d=nd, stiff=2.2)
    ell('neck', mix(J['withers'], J['neck_top'], 0.2) + np.array((0.025, 0, -0.045)), (0.055, 0.05, 0.045), stiff=2.2)  # 목 아래
    ell('neck', mix(J['withers'], J['neck_top'], 0.8) + np.array((0.02, 0, -0.03)), (0.04, 0.042, 0.035), stiff=2.5)   # 목젖/턱밑
    # --- 머리 (측정: 머리 높이 0.125, 폭 0.13, 눈은 위에서 31%, 코는 72% 지점)
    HX, HZ = 0.415, 0.452          # 두개골 중심
    ell('head', (HX, 0, HZ), (0.058, P['skull_half_w'], 0.050), stiff=2.3)                  # 둥근 두개골
    ell('head', (HX + 0.035, 0, HZ + 0.004), (0.038, 0.054, 0.038), stiff=2.5)              # 이마/눈두덩 (넓은 이마)
    mirror(lambda s, g: ell('head', (HX + 0.02, g * 0.042, HZ - 0.03), (0.04, 0.026, 0.03), stiff=2.6))   # 볼
    MZ = 0.414
    ell('head', (0.498, 0, MZ + 0.006), (0.040, P['muzzle_half_w'], 0.030), d=(1, 0, -0.08), stiff=3.0)   # 주둥이 (짧고 네모, 깊음)
    ell('head', (0.524, 0, MZ + 0.004), (0.020, P['muzzle_half_w'] - 0.002, 0.027), stiff=3.5)             # 주둥이 끝(뭉툭)
    ell('head', (0.495, 0, MZ - 0.024), (0.038, 0.030, 0.018), stiff=3.0)                                  # 아래턱/늘어진 입술(flews)
    mirror(lambda s, g: ell('head', (0.50, g * 0.022, MZ - 0.012), (0.03, 0.012, 0.018), stiff=3.5))        # 윗입술 옆 볼륨
    ell('head', (0.462, 0, 0.437), (0.028, 0.042, 0.032), stiff=3.0)                                        # 스톱(눈 사이)~주둥이 뿌리
    # --- 다리 (짧고 튼튼: 앞다리 폭 ~0.06, 발은 다리와 자연스럽게 연결)
    def legs(s, g):
        limb('upperarm.' + s, J['shoulder.' + s], J['elbow.' + s], P['leg_r_upper'] + 0.006, P['leg_r_upper'], stiff=2.4, pad=0.6, bulge=1.1)
        limb('forearm.' + s, J['elbow.' + s], (J['wrist.' + s][0], J['wrist.' + s][1], 0.035), P['leg_r_lower'] + 0.002, P['leg_r_lower'], stiff=2.6, pad=0.5)
        wr = V(J['wrist.' + s])
        ell('fpaw.' + s, (wr[0] + 0.022, wr[1], P['paw_h'] - 0.002), (P['paw_len'] / 2, P['paw_half_w'], P['paw_h'] + 0.004), stiff=3.0)
        ell('thigh.' + s, mix(J['hip.' + s], J['stifle.' + s], 0.45), (0.078, P['thigh_r'] * 0.70, P['thigh_r']),
            d=tuple(V(J['stifle.' + s]) - V(J['hip.' + s])), stiff=2.3)
        limb('shin.' + s, J['stifle.' + s], J['hock.' + s], P['shin_r'] + 0.006, P['shin_r'], stiff=2.6, pad=0.6)
        limb('hpaw.' + s, J['hock.' + s], (J['hpaw.' + s][0] - 0.005, J['hpaw.' + s][1], 0.025), 0.022, 0.021, stiff=2.8, pad=0.4)
        hp = V(J['hpaw.' + s])
        ell('hpaw.' + s, (hp[0] + 0.018, hp[1], P['paw_h'] - 0.002), (P['paw_len'] / 2 - 0.004, P['paw_half_w'] - 0.002, P['paw_h'] + 0.004), stiff=3.0)
    mirror(legs)
    # --- 꼬리
    limb('tail1', J['tailbase'], J['tail_mid'], 0.015, 0.012, stiff=3.0, pad=0.7)
    limb('tail2', J['tail_mid'], J['tail_tip'], 0.011, 0.009, stiff=3.0, pad=0.9)

def build_metaball_mesh(res=0.0055):
    mb = bpy.data.metaballs.new('pinky_mb')
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = MB_THRESH
    for e in ELEMS:
        el = mb.elements.new()
        el.type = 'ELLIPSOID'
        el.co = Vector(e['co'])
        el.radius = 1.0
        el.stiffness = e['stiff']
        f = vis_frac(e['stiff'])
        el.size_x, el.size_y, el.size_z = [max(0.001, a / f) for a in e['axes']]
        el.rotation = e['rot']
        el.use_negative = e['neg']
    ob = bpy.data.objects.new('pinky_mb', mb)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    return me

def remesh_smooth(me, voxel=0.0048, smooth_iter=6, smooth_fac=0.6):
    """복셀 리메시 + 스무스 → 균일한 유기적 토폴로지"""
    ob = bpy.data.objects.new('tmp_rm', me)
    bpy.context.scene.collection.objects.link(ob)
    rm = ob.modifiers.new('rm', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    rm.use_smooth_shade = True
    sm = ob.modifiers.new('sm', 'SMOOTH')
    sm.factor = smooth_fac
    sm.iterations = smooth_iter
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return me2

def mesh_arrays(me):
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get('co', co)
    return co.reshape(n, 3)

# ----------------------------------------------------------------------------
# 4a. 간단한 numpy 노이즈 (텍스처용)
# ----------------------------------------------------------------------------
def _hash3(ix, iy, iz, seed):
    h = np.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 19.19) * 43758.5453
    return h - np.floor(h)

def vnoise(p, scale, seed=0.0):
    q = p * scale
    i = np.floor(q)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = np.zeros(len(p))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out += w * _hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out

def fbm(p, scale, seed=0.0, octaves=3):
    out = np.zeros(len(p)); amp = 0.5; tot = 0
    for o in range(octaves):
        out += amp * vnoise(p, scale * 2 ** o, seed + o)
        tot += amp; amp *= 0.5
    return out / tot

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)

# ----------------------------------------------------------------------------
# 4b. 삼색 무늬 (레스트 포즈 좌표 기준 → 버텍스 컬러에 저장하므로 포즈가 바뀌어도 무늬 고정)
# ----------------------------------------------------------------------------
def coat_color(p):
    """p: (N,3) 레스트 포즈 좌표 → (N,3) sRGB 색"""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    ay = np.abs(y)
    n1 = fbm(p, 18.0, 1.0) - 0.5          # 큰 얼룩 경계 흔들림
    n2 = fbm(p, 60.0, 2.0) - 0.5          # 털결 얼룩
    n3 = vnoise(p, 260.0, 3.0)            # 미세 플렉
    white, tan, tang, sad, fleck = (np.array(COL[k]) for k in ('white', 'tan', 'tan_grey', 'saddle', 'saddle_fleck'))
    N = len(p)
    col = np.tile(white, (N, 1))

    # ---- 몸통 높이 비율 h (0=배 바닥, 1=등)
    zb = P['chest_bottom_z'] + 0.02 * smoothstep(0.2, -0.05, x)        # 뒤로 갈수록 배가 조금 올라감
    zt = WZ - 0.02 * smoothstep(0.2, -0.05, x)
    h = (z - zb) / (zt - zb)
    torso = smoothstep(-0.13, -0.06, x) * smoothstep(0.37, 0.30, x)    # 몸통 영역 (x 범위)
    # 황갈색: 옆구리 중간 높이 이상 (배/가슴은 흰색)
    tan_w = smoothstep(0.22, 0.42, h + 0.12 * n1)
    tan_w = tan_w * torso
    # 어깨: 황갈/회색 (앞다리 윗부분까지)
    sh = np.exp(-(((x - 0.30) / 0.06) ** 2 + ((z - 0.25) / 0.07) ** 2)) * smoothstep(0.03, 0.055, ay)
    tan_w = np.maximum(tan_w, 0.9 * sh)
    # 허벅지: 황갈색 (뒷다리 윗부분), 안쪽/뒤쪽은 흰색
    th = np.exp(-(((x - 0.0) / 0.075) ** 2 + ((z - 0.19) / 0.075) ** 2)) * smoothstep(0.035, 0.06, ay)
    th *= smoothstep(-0.085, -0.04, x + 0.03 * n1)                     # 허벅지 뒤쪽 흰 '바지'
    tan_w = np.maximum(tan_w, th)
    # 목: 윗부분/옆은 황갈, 목 앞(목젖)과 가슴은 흰색
    neck_ax = (x - 0.29) * 0.67 + (z - WZ) * 0.74
    neck_up = -(x - 0.29) * 0.74 + (z - WZ) * 0.67 + 0.02
    neck_reg = smoothstep(-0.02, 0.02, neck_ax) * smoothstep(0.14, 0.09, neck_ax)
    neck_tan = neck_reg * smoothstep(-0.055, -0.01, neck_up + 0.03 * n1 + 0.5 * ay)
    tan_w = np.maximum(tan_w, neck_tan)
    # 머리: 황갈 (주둥이/턱/블레이즈 제외)
    head_reg = smoothstep(0.33, 0.38, x) * smoothstep(0.37, 0.41, z + 0.4 * ay)
    muzzle = smoothstep(0.455, 0.475, x + 0.25 * (z - 0.42)) * smoothstep(0.455, 0.44, z - 0.3 * (x - 0.47))
    muzzle = np.maximum(muzzle, smoothstep(0.405, 0.385, z) * smoothstep(0.40, 0.44, x))     # 턱 아래
    blaze = np.exp(-((ay / (0.012 + 0.012 * smoothstep(0.50, 0.44, x))) ** 2)) * smoothstep(0.42, 0.45, x) * smoothstep(0.40, 0.43, z)
    blaze = blaze * (0.75 + 0.25 * n2)
    head_tan = head_reg * (1 - muzzle) * (1 - 0.85 * blaze)
    tan_w = np.maximum(tan_w, head_tan)
    # 꼬리: 황갈, 끝 1/3 흰색, 아랫면 밝게
    tail_reg = smoothstep(-0.07, -0.10, x) * smoothstep(0.26, 0.29, z)
    tail_tan = tail_reg * smoothstep(-0.20, -0.165, x + 0.02 * n1) * smoothstep(0.29, 0.33, z + 0.02)
    tan_w = np.maximum(tan_w, tail_tan)

    tan_col = np.where((head_reg > 0.5)[:, None], np.array(mix(tan, tang, 0.45)), tan)
    tan_col = tan_col * (0.93 + 0.14 * n2)[:, None]
    col = col * (1 - tan_w)[:, None] + tan_col * tan_w[:, None]

    # ---- 등의 차콜 안장: 기갑~꼬리 밑, 몸통 윗부분 (옆으로 내려오며 황갈로 페이드)
    sad_w = smoothstep(0.40, 0.56, h + 0.08 * n1 - 0.12 * smoothstep(0.24, 0.33, x) + 0.08 * smoothstep(-0.02, -0.08, x))
    sad_w *= smoothstep(-0.12, -0.06, x) * smoothstep(0.34, 0.29, x)
    # 허벅지 윗부분까지 회갈색으로 이어짐
    sad_w = np.maximum(sad_w, 0.7 * np.exp(-(((x + 0.02) / 0.06) ** 2 + ((z - 0.25) / 0.035) ** 2)) * smoothstep(0.045, 0.07, ay))
    # 어깨 뒤/허벅지 위에 회색 얼룩 (사진: 어깨에 회색 반점)
    sad_w = np.maximum(sad_w, 0.85 * np.exp(-(((x - 0.285) / 0.05) ** 2 + ((z - 0.25) / 0.055) ** 2)) * smoothstep(0.045, 0.07, ay))
    sad_w = np.maximum(sad_w, 0.6 * np.exp(-(((x - 0.0) / 0.05) ** 2 + ((z - 0.235) / 0.04) ** 2)) * smoothstep(0.05, 0.075, ay))
    # 목덜미는 차콜이 옅음(회갈색)
    sad_w *= (1 - 0.5 * smoothstep(0.26, 0.33, x))
    # 차콜에 회색 털이 섞인 느낌: 연속적인 노이즈로만 (점박이 방지, 미세 플렉은 셰이더/털이 담당)
    sad_col = sad * (1 - 0.28 * np.clip(n2 + 0.5, 0, 1))[:, None] + fleck * (0.28 * np.clip(n2 + 0.5, 0, 1))[:, None]
    col = col * (1 - sad_w)[:, None] + sad_col * sad_w[:, None]

    # ---- 흰색 다리: 팔꿈치/무릎 아래는 항상 흰색
    legs_w = smoothstep(0.185, 0.145, z) * smoothstep(0.03, 0.05, ay) * (1 - tail_reg)
    legs_w = np.maximum(legs_w, smoothstep(0.17, 0.12, z) * smoothstep(-0.06, 0.03, x) * smoothstep(0.035, 0.055, ay))
    col = col * (1 - legs_w)[:, None] + white * legs_w[:, None]

    # ---- 얼굴 디테일: 눈 테두리(짙은 색), 입선, 주둥이 측면 회색기
    for sgn in (1, -1):
        ec = eye_center(sgn)
        d = np.linalg.norm(p - ec, axis=1)
        ring = smoothstep(0.010, 0.013, d) * smoothstep(0.019, 0.015, d)
        col = col * (1 - 0.8 * ring)[:, None] + np.array(COL['rim']) * (0.8 * ring)[:, None]
    lipz = 0.403 - 0.02 * (x - 0.50) ** 2 / 0.003
    lip = np.exp(-((z - lipz) / 0.0022) ** 2) * smoothstep(0.46, 0.49, x) * smoothstep(0.012, 0.022, ay) * smoothstep(0.036, 0.03, ay)
    col = col * (1 - 0.85 * lip)[:, None] + np.array(COL['lip']) * (0.85 * lip)[:, None]
    # 주둥이 윗면 미세 그레이(주근깨 느낌)
    frk = smoothstep(0.46, 0.5, x) * smoothstep(0.39, 0.41, z) * (n3 > 0.9)
    col = col * (1 - 0.25 * frk)[:, None]
    # 전체 미세 변조
    col = col * (0.96 + 0.08 * n3)[:, None]
    return np.clip(col, 0, 1)

def eye_center(sgn):
    return np.array((0.465, sgn * P['eye_sep'] / 2, 0.457))

def eye_axis(sgn):
    d = Vector((0.78, sgn * 0.56, 0.20)).normalized()   # 약간 바깥쪽/위쪽을 향함
    return d

# ----------------------------------------------------------------------------
# 4c. 뼈 가중치: 각 메타볼 요소가 정점에 미치는 영향으로 계산 → 관절에서 자연스럽게 섞임
# ----------------------------------------------------------------------------
def compute_weights(co):
    bones = [b[0] for b in BONES]
    bidx = {b: i for i, b in enumerate(bones)}
    W = np.zeros((len(co), len(bones)))
    for e in ELEMS:
        if e['neg']:
            continue
        R = np.array(e['rot'].to_matrix())           # columns = local axes
        local = (co - e['co']) @ R                   # to element frame
        nd = np.linalg.norm(local / (e['axes'] * 1.25 + 0.012), axis=1)
        c = np.clip(1 - nd ** 2, 0, None) ** 2
        W[:, bidx[e['bone']]] += c
    # 뼈 중심선 기반 보조 가중치 (요소 바깥 정점 대비)
    for b in bones:
        h, t = BONE_HEAD[b], BONE_TAIL[b]
        d = t - h; L2 = d @ d
        tt = np.clip(((co - h) @ d) / L2, 0, 1)
        dist = np.linalg.norm(co - (h + tt[:, None] * d), axis=1)
        W[:, bidx[b]] += 0.05 * np.exp(-(dist / 0.05) ** 2)
    # 상위 4개만 유지, 정규화
    idx = np.argsort(-W, axis=1)[:, :4]
    keep = np.zeros_like(W)
    np.put_along_axis(keep, idx, np.take_along_axis(W, idx, 1), 1)
    keep[keep < 1e-4] = 0
    s = keep.sum(1, keepdims=True)
    s[s == 0] = 1
    return keep / s, bones

def fur_length_weight(co):
    """털 길이 가중치: 몸통 1.0, 머리/다리/꼬리끝 짧게"""
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    w = np.full(len(co), 0.9)
    w = np.where(x > 0.33, 0.45, w)                        # 머리/목 앞
    w = np.where(x > 0.44, 0.3, w)                         # 주둥이
    w = np.minimum(w, np.where(z < 0.17, 0.5, 1.0))        # 다리
    w = np.minimum(w, np.where(z < 0.04, 0.3, 1.0))        # 발
    w = np.where(x < -0.09, 1.0, w)                        # 꼬리 (털 조금 더 북슬)
    return w

# ----------------------------------------------------------------------------
# 5. 메쉬 유틸
# ----------------------------------------------------------------------------
def new_mesh_obj(name, verts, faces, col=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def grid_faces(nv, nu, close_u=False):
    faces = []
    nu2 = nu if close_u else nu - 1
    for i in range(nv - 1):
        for j in range(nu2):
            j2 = (j + 1) % nu
            faces.append((i * nu + j, i * nu + j2, (i + 1) * nu + j2, (i + 1) * nu + j))
    return faces

def set_vertex_colors(ob, rgb_lin_per_vertex, name='Col'):
    """정점별 선형 RGB → 페이스 코너 BYTE_COLOR 속성 (Cycles 헤어도 이 속성을 읽음, glTF 로도 내보내짐)"""
    me = ob.data
    attr = me.color_attributes.new(name, 'BYTE_COLOR', 'CORNER')
    nloops = len(me.loops)
    li = np.empty(nloops, dtype=np.int32)
    me.loops.foreach_get('vertex_index', li)
    c = np.ones((nloops, 4))
    c[:, :3] = rgb_lin_per_vertex[li]
    attr.data.foreach_set('color', c.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0

def bmesh_sphere(name, r, u=32, v=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

# ----------------------------------------------------------------------------
# 6. 재질
# ----------------------------------------------------------------------------
def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt, nt.nodes, nt.links

def mat_skin():
    mat = bpy.data.materials.new('pinky_skin')
    nt, nodes, links = _nodes(mat)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    attr = nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Col'
    # 미세 털결 노이즈로 색 변조 + 범프
    tex = nodes.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value = 900; tex.inputs['Detail'].default_value = 3
    mixc = nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'; mixc.blend_type = 'MULTIPLY'; mixc.inputs['Factor'].default_value = 0.25
    links.new(attr.outputs['Color'], mixc.inputs[6])
    links.new(tex.outputs['Color'], mixc.inputs[7])
    links.new(mixc.outputs[2], bsdf.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.15; bump.inputs['Distance'].default_value = 0.0005
    links.new(tex.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.8
    bsdf.inputs['Specular IOR Level'].default_value = 0.25
    bsdf.inputs['Subsurface Weight'].default_value = 0.08
    bsdf.inputs['Subsurface Radius'].default_value = (0.01, 0.006, 0.004)
    bsdf.inputs['Subsurface Scale'].default_value = 0.3
    links.new(bsdf.outputs[0], out.inputs[0])
    return mat

def mat_fur(name='pinky_fur', tint=1.0):
    mat = bpy.data.materials.new(name)
    nt, nodes, links = _nodes(mat)
    out = nodes.new('ShaderNodeOutputMaterial')
    hair = nodes.new('ShaderNodeBsdfHairPrincipled')
    hair.model = 'CHIANG'
    hair.parametrization = 'COLOR'
    attr = nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Col'
    # 뿌리는 조금 어둡고 끝은 밝게 (부드러운 털 명암)
    info = nodes.new('ShaderNodeHairInfo')
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.55, 0.52, 0.5, 1)
    ramp.color_ramp.elements[1].color = (1.15, 1.13, 1.1, 1)
    links.new(info.outputs['Intercept'], ramp.inputs['Fac'])
    mul = nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1.0
    links.new(attr.outputs['Color'], mul.inputs[6])
    links.new(ramp.outputs['Color'], mul.inputs[7])
    links.new(mul.outputs[2], hair.inputs['Color'])
    hair.inputs['Roughness'].default_value = 0.35
    hair.inputs['Radial Roughness'].default_value = 0.4
    hair.inputs['Coat'].default_value = 0.1
    hair.inputs['Random Roughness'].default_value = 0.2
    links.new(hair.outputs[0], out.inputs[0])
    return mat

def mat_eye():
    """홍채/동공: 눈 오브젝트 로컬 +Z 가 시선 방향"""
    mat = bpy.data.materials.new('pinky_eye')
    nt, nodes, links = _nodes(mat)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    tc = nodes.new('ShaderNodeTexCoord')
    # 각도 = 1 - z/r  (0 = 정면 중심)
    sep = nodes.new('ShaderNodeSeparateXYZ'); links.new(tc.outputs['Object'], sep.inputs[0])
    norm = nodes.new('ShaderNodeVectorMath'); norm.operation = 'NORMALIZE'; links.new(tc.outputs['Object'], norm.inputs[0])
    sep2 = nodes.new('ShaderNodeSeparateXYZ'); links.new(norm.outputs[0], sep2.inputs[0])
    inv = nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    links.new(sep2.outputs['Z'], inv.inputs[1])
    ramp = nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.interpolation = 'EASE'
    cr.elements[0].position = 0.0; cr.elements[0].color = (0.004, 0.003, 0.002, 1)          # 동공
    e1 = cr.elements.new(0.09); e1.color = (0.006, 0.004, 0.002, 1)
    e2 = cr.elements.new(0.13); e2.color = (0.09, 0.045, 0.02, 1)                           # 짙은 갈색 홍채
    e3 = cr.elements.new(0.30); e3.color = (0.05, 0.025, 0.012, 1)
    e4 = cr.elements.new(0.36); e4.color = (0.016, 0.012, 0.01, 1)                          # 홍채 가장자리(림)
    e5 = cr.elements.new(0.44); e5.color = (0.35, 0.3, 0.26, 1)                             # 공막 (거의 안 보임)
    cr.elements[-1].color = (0.3, 0.26, 0.22, 1)
    links.new(inv.outputs[0], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Specular IOR Level'].default_value = 0.3
    links.new(bsdf.outputs[0], out.inputs[0])
    return mat

def mat_cornea():
    mat = bpy.data.materials.new('pinky_cornea')
    nt, nodes, links = _nodes(mat)
    out = nodes.new('ShaderNodeOutputMaterial')
    g = nodes.new('ShaderNodeBsdfGlass')
    g.inputs['Roughness'].default_value = 0.02
    g.inputs['IOR'].default_value = 1.38
    g.inputs['Color'].default_value = (1, 1, 1, 1)
    links.new(g.outputs[0], out.inputs[0])
    return mat

def mat_nose():
    mat = bpy.data.materials.new('pinky_nose')
    nt, nodes, links = _nodes(mat)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.012, 0.011, 0.011, 1)
    bsdf.inputs['Roughness'].default_value = 0.32
    bsdf.inputs['Specular IOR Level'].default_value = 0.6
    bsdf.inputs['Coat Weight'].default_value = 0.4
    bsdf.inputs['Coat Roughness'].default_value = 0.15
    tex = nodes.new('ShaderNodeTexVoronoi'); tex.inputs['Scale'].default_value = 1500
    bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; bump.inputs['Distance'].default_value = 0.0006
    links.new(tex.outputs['Distance'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    links.new(bsdf.outputs[0], out.inputs[0])
    return mat

def mat_vertexcolor(name, rough=0.6, spec=0.3, metallic=0.0):
    mat = bpy.data.materials.new(name)
    nt, nodes, links = _nodes(mat)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    attr = nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Col'
    links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Specular IOR Level'].default_value = spec
    bsdf.inputs['Metallic'].default_value = metallic
    links.new(bsdf.outputs[0], out.inputs[0])
    return mat

def mat_bronze():
    mat = bpy.data.materials.new('pinky_medal')
    nt, nodes, links = _nodes(mat)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.11, 0.07, 0.045, 1)
    bsdf.inputs['Metallic'].default_value = 0.9
    bsdf.inputs['Roughness'].default_value = 0.55
    tex = nodes.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value = 400; tex.inputs['Detail'].default_value = 6
    bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25; bump.inputs['Distance'].default_value = 0.0004
    links.new(tex.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    links.new(bsdf.outputs[0], out.inputs[0])
    return mat

def mat_floor():
    mat = bpy.data.materials.new('floor')
    nt, nodes, links = _nodes(mat)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfDiffuse')
    bsdf.inputs['Color'].default_value = (*srgb_to_lin(COL['bg']), 1)
    links.new(bsdf.outputs[0], out.inputs[0])
    return mat

# ----------------------------------------------------------------------------
# 7. 캐릭터 빌드
# ----------------------------------------------------------------------------
class Pinky:
    def __init__(self, fur=True, fur_scale=1.0):
        self.fur = fur
        self.fur_scale = fur_scale
        self.objs = {}
        self.build()

    # --- 바디 메쉬 ---------------------------------------------------------
    def build_body(self):
        build_elements()
        t = time.time()
        me = build_metaball_mesh()
        me = remesh_smooth(me)
        co = mesh_arrays(me)
        # 발바닥 평평하게 + 바닥 아래로 내려간 부분 정리
        co[:, 2] = np.maximum(co[:, 2], 0.002)
        me.vertices.foreach_set('co', co.ravel())
        me.update()
        body = bpy.data.objects.new('Pinky_Body', me)
        bpy.context.scene.collection.objects.link(body)
        print(f'[body] verts={len(me.vertices)} faces={len(me.polygons)} ({time.time() - t:.1f}s)')
        self.body = body
        self.body_co = co
        # 색상
        col = coat_color(co)
        set_vertex_colors(body, srgb_to_lin(col))
        # 뼈 가중치
        W, bones = compute_weights(co)
        for bi, b in enumerate(bones):
            vg = body.vertex_groups.new(name=b)
            w = W[:, bi]
            nz = np.nonzero(w > 0)[0]
            for i in nz:
                vg.add([int(i)], float(w[i]), 'REPLACE')
        fl = fur_length_weight(co)
        vg = body.vertex_groups.new(name='furlen')
        for i in range(len(co)):
            vg.add([i], float(fl[i]), 'REPLACE')
        body.data.materials.append(mat_skin())
        self.bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())

    # --- 아마추어 ---------------------------------------------------------
    def build_armature(self):
        arm = bpy.data.armatures.new('Pinky_Rig')
        ao = bpy.data.objects.new('Pinky_Rig', arm)
        bpy.context.scene.collection.objects.link(ao)
        bpy.context.view_layer.objects.active = ao
        bpy.ops.object.mode_set(mode='EDIT')
        ebs = {}
        for name, hj, tj, parent in BONES:
            eb = arm.edit_bones.new(name)
            eb.head = Vector(J[hj]); eb.tail = Vector(J[tj])
            eb.roll = 0.0
            ebs[name] = eb
        for name, hj, tj, parent in BONES:
            if parent:
                ebs[name].parent = ebs[parent]
                ebs[name].use_connect = False
        bpy.ops.object.mode_set(mode='OBJECT')
        arm.display_type = 'STICK'
        self.arm = ao
        self.rest_local = {b.name: b.matrix_local.copy() for b in arm.bones}
        # 바디에 아마추어 모디파이어
        self.body.parent = ao
        mod = self.body.modifiers.new('Armature', 'ARMATURE')
        mod.object = ao
        mod.use_deform_preserve_volume = True
        sub = self.body.modifiers.new('Subdiv', 'SUBSURF')
        sub.levels = 1; sub.render_levels = 1

    def bone_parent(self, ob, bone):
        ob.parent = self.arm
        ob.parent_type = 'BONE'
        ob.parent_bone = bone
        # 뼈 부모는 뼈 '끝(tail)' 기준이므로 보정
        ob.matrix_parent_inverse = (self.arm.matrix_world @ self.arm.pose.bones[bone].matrix @ Matrix.Translation((0, self.arm.data.bones[bone].length, 0))).inverted()

    def surface_point(self, origin, direction):
        """바디 표면과의 교점 (origin 에서 direction 으로 레이캐스트)"""
        hit = self.bvh.ray_cast(Vector(origin), Vector(direction).normalized(), 1.0)
        return (np.array(hit[0]), np.array(hit[1])) if hit[0] is not None else (None, None)

    # --- 귀 ---------------------------------------------------------------
    def build_ears(self):
        fur_mat = mat_fur('pinky_fur_ear')
        for s, sgn in (('L', 1), ('R', -1)):
            base = V(J['ear.' + s]); tip = V(J['ear_tip.' + s])
            nv, nu = 30, 13
            verts = np.zeros((nv, nu, 3))
            L = P['ear_len']; hw0 = P['ear_half_w']
            # 귀의 로컬 프레임: 앞가장자리는 뺨(눈 옆)에 붙고 뒷가장자리는 바깥/뒤로 벌어짐 (약 40도)
            alpha = math.radians(40)
            wdir = np.array((-math.cos(alpha), sgn * math.sin(alpha), 0.0))        # 앞 → 뒤 가장자리 방향
            ddir = np.array((0.06, sgn * 0.04, -1.0)); ddir /= np.linalg.norm(ddir)  # 아래로 (살짝 앞/바깥)
            ndir = np.cross(wdir, ddir)                                            # 귀 바깥면 법선
            if ndir[1] * sgn < 0:
                ndir = -ndir
            for i in range(nv):
                v = i / (nv - 1)
                # 폭: 뿌리는 좁고 중간~아래 넓은 잎 모양, 끝은 둥글게
                hw = hw0 * math.sqrt(max(0.0, 1 - ((v - 0.58) / 0.66) ** 2)) * (1 - v ** 8) ** 0.5
                hw = max(hw, 0.008)
                # 중심선: 매달린 채 윗부분이 살짝 바깥으로 접히고(fold) 아래는 거의 수직
                fold = 0.003 * math.exp(-((v - 0.15) / 0.18) ** 2)
                center = base + ddir * (L * v) + ndir * fold - ndir * (0.004 * smoothstep(0.5, 1.0, np.array([v]))[0])
                # 윗부분은 뒤쪽으로 살짝 치우침(귀 뿌리가 두개골 뒤쪽), 아래로 갈수록 앞으로(뺨 쪽)
                center = center + wdir * (0.010 * (1 - v) - 0.006 * v)
                for j in range(nu):
                    u = (j / (nu - 1)) * 2 - 1
                    # 귀가 뺨을 감싸듯 가운데가 바깥으로 볼록 (컵 모양), 뿌리 쪽에서 더 둥글게
                    cup = -0.008 * (1 - u * u) * (0.5 + 0.5 * math.sin(math.pi * min(v, 1.0)))
                    p = center + wdir * (u * hw) + ndir * cup
                    verts[i, j] = p
            # 머리/목 속으로 들어간 정점은 표면 밖으로 밀어냄 (3 mm 간격 유지)
            flat = verts.reshape(-1, 3)
            for k in range(len(flat)):
                near = self.bvh.find_nearest(Vector(flat[k]))
                if near[0] is None:
                    continue
                q, n = np.array(near[0]), np.array(near[1])
                dist = (flat[k] - q) @ n
                if dist < 0.003:
                    flat[k] = q + n * 0.003
            verts = flat.reshape(nv, nu, 3)
            faces = grid_faces(nv, nu)
            ob = new_mesh_obj('Pinky_Ear_' + s, verts.reshape(-1, 3), faces)
            sol = ob.modifiers.new('Solid', 'SOLIDIFY'); sol.thickness = 0.005; sol.offset = -1.0
            sol.use_rim = True; sol.use_even_offset = True
            sub = ob.modifiers.new('Subdiv', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
            # 귀 색: 회색기 황갈, 가장자리/아래쪽 조금 어둡게, 안쪽면 밝게
            co = verts.reshape(-1, 3)
            vv = np.repeat(np.linspace(0, 1, nv), nu)
            uu = np.tile(np.abs(np.linspace(-1, 1, nu)), nv)
            n2 = fbm(co, 70.0, 5.0) - 0.5
            base_c = np.array(mix(COL['tan'], COL['tan_grey'], 0.55))
            dark = np.array(mix(COL['tan_grey'], COL['saddle'], 0.35))
            t = np.clip(0.35 * uu + 0.25 * smoothstep(0.5, 1.0, vv) + 0.6 * n2, 0, 1)
            c = base_c * (1 - t)[:, None] + dark * t[:, None]
            c *= (0.95 + 0.1 * vnoise(co, 300, 7))[:, None]
            set_vertex_colors(ob, srgb_to_lin(np.clip(c, 0, 1)))
            ob.data.materials.append(mat_vertexcolor('pinky_ear_skin', rough=0.85, spec=0.2))
            self.bone_parent(ob, 'ear.' + s)
            self.objs['ear.' + s] = ob
            if self.fur:
                self.add_fur(ob, count=int(2500 * self.fur_scale), length=0.004, children=12, mat=fur_mat, clump=0.3)

    # --- 눈 ---------------------------------------------------------------
    def build_eyes(self):
        em, cm = mat_eye(), mat_cornea()
        for s, sgn in (('L', 1), ('R', -1)):
            c = eye_center(sgn)
            ax = eye_axis(sgn)
            # 머리 표면 위치를 찾아 안구를 표면 안쪽으로 박아 넣음 (튀어나온 구슬 방지)
            hit, nrm = self.surface_point(c + np.array(ax) * 0.1, -np.array(ax))
            if hit is not None:
                c = hit - np.array(ax) * (P['eye_r'] * 0.55)
            eye = bmesh_sphere('Pinky_Eye_' + s, P['eye_r'], u=48, v=32)
            eye.data.materials.append(em)
            # glTF 뷰어용: 홍채/동공을 버텍스 컬러로도 기록 (Cycles 는 셰이더의 램프를 사용)
            eco = mesh_arrays(eye.data)
            ang = 1 - eco[:, 2] / np.linalg.norm(eco, axis=1)
            ecol = np.where((ang < 0.10)[:, None], np.array((0.02, 0.015, 0.01)),
                            np.where((ang < 0.36)[:, None], np.array((0.22, 0.12, 0.06)),
                                     np.where((ang < 0.43)[:, None], np.array((0.10, 0.07, 0.05)), np.array((0.62, 0.56, 0.5)))))
            set_vertex_colors(eye, srgb_to_lin(ecol))
            rot = ax.to_track_quat('Z', 'Y').to_matrix().to_4x4()
            eye.matrix_world = Matrix.Translation(Vector(c)) @ rot
            cornea = bmesh_sphere('Pinky_Cornea_' + s, P['eye_r'] * 1.035)
            cornea.data.materials.append(cm)
            cornea.matrix_world = eye.matrix_world.copy()
            # 각막은 그림자를 만들지 않도록
            cornea.visible_shadow = False
            for ob in (eye, cornea):
                self.bone_parent(ob, 'head')
            self.objs['eye.' + s] = eye

    # --- 코 ---------------------------------------------------------------
    def build_nose(self):
        c = V(J['nose'])
        hit, nrm = self.surface_point(c + np.array((0.1, 0, 0.0)), (-1, 0, 0))
        if hit is not None:
            c = hit - np.array((0.005, 0, 0.0))
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1.0)
        for v in bm.verts:
            x, y, z = v.co
            # 앞이 둥글넓적하고 위가 평평한 코 모양 (폭 0.021, 높이 0.015)
            v.co = Vector((x * 0.0105 * (1 + 0.15 * max(0, -z)), y * 0.0135 * (1 + 0.15 * (1 - z * z)), z * 0.0095 - 0.0015 * x))
        me = bpy.data.meshes.new('Pinky_Nose')
        bm.to_mesh(me); bm.free()
        for p in me.polygons:
            p.use_smooth = True
        ob = bpy.data.objects.new('Pinky_Nose', me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = Vector(c)
        ob.data.materials.append(mat_nose())
        sub = ob.modifiers.new('Subdiv', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
        self.bone_parent(ob, 'head')
        self.objs['nose'] = ob

    # --- 목걸이 + 메달 ------------------------------------------------------
    def build_collar(self):
        # 목 축: 기갑→머리 방향, 목걸이는 목 아랫부분(어깨 가까이)에 위치
        # 느슨한 목걸이: 뒤쪽은 목덜미(머리 가까이), 앞쪽은 가슴 위로 늘어져 비스듬히 걸림
        a = V(J['withers'])
        axis = V(0.70, 0, 0.71)
        center = a + np.array((0.045, 0, -0.005))
        rot = rot_from_dir(tuple(axis))
        R = np.array(rot.to_matrix())   # col0 = axis, col1 = lateral, col2 = 'up'
        lat, up = R[:, 1], R[:, 2]
        n_ang, n_w = 72, 6
        width = 0.017
        verts = np.zeros((n_w, n_ang, 3))
        cols = np.zeros((n_w * n_ang, 3))
        stripes = [(0.00, 0.22, (0.55, 0.16, 0.12)), (0.22, 0.40, (0.92, 0.90, 0.86)),
                   (0.40, 0.62, (0.10, 0.12, 0.26)), (0.62, 0.80, (0.92, 0.90, 0.86)), (0.80, 1.01, (0.55, 0.16, 0.12))]
        for k in range(n_ang):
            th = 2 * math.pi * k / n_ang
            d = math.cos(th) * up + math.sin(th) * lat        # th=0 : 위(등쪽)
            for i in range(n_w):
                t = i / (n_w - 1)
                off = axis * (width * (t - 0.5))
                origin = center + off
                hit, nrm = self.surface_point(origin + d * 0.25, -d)
                if hit is None:
                    hit = origin + d * 0.065
                sag = 0.02 * max(0.0, -math.cos(th)) ** 2       # 아래쪽(가슴 쪽)은 늘어짐
                pt = hit + d * 0.0035 + np.array((sag * 0.5, 0, -sag))
                verts[i, k] = pt
                for s0, s1, c in stripes:
                    if s0 <= t < s1:
                        cols[i * n_ang + k] = c
        faces = grid_faces(n_w, n_ang, close_u=True)
        ob = new_mesh_obj('Pinky_Collar', verts.reshape(-1, 3), faces)
        sol = ob.modifiers.new('Solid', 'SOLIDIFY'); sol.thickness = 0.0025; sol.offset = 1.0
        # 줄무늬는 코너 색으로 선명하게
        me = ob.data
        attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
        cl = np.ones((len(me.loops), 4))
        for poly in me.polygons:
            # 각 면의 색: 그 면의 '행(i)' 색
            i_row = poly.vertices[0] // n_ang
            tmid = (i_row + 0.5) / (n_w - 1)
            c = stripes[-1][2]
            for s0, s1, cc in stripes:
                if s0 <= tmid < s1:
                    c = cc
            for li in poly.loop_indices:
                cl[li, :3] = srgb_to_lin(c)
        attr.data.foreach_set('color', cl.ravel())
        me.color_attributes.active_color = attr
        ob.data.materials.append(mat_vertexcolor('pinky_collar', rough=0.7, spec=0.25))
        self.bone_parent(ob, 'spine3')   # 느슨한 목걸이는 어깨(목 밑동)에 걸려 있으므로 가슴 뼈를 따라감
        self.objs['collar'] = ob
        # 메달: 목걸이 아래 중앙(th=pi)에서 고리로 매달림
        bottom = verts[n_w // 2, n_ang // 2]
        ring_c = bottom + np.array((0.008, 0, -0.010))
        medal_c = ring_c + np.array((0.010, 0, -0.031))
        # 고리 (토러스)
        rv = np.zeros((10, 20, 3))
        for i in range(10):
            ph = 2 * math.pi * i / 10
            for k in range(20):
                th = 2 * math.pi * k / 20
                rr = 0.0085 + 0.0014 * math.cos(ph)
                rv[i, k] = ring_c + np.array((0.0014 * math.sin(ph), rr * math.sin(th), rr * math.cos(th)))
        ring = new_mesh_obj('Pinky_Ring', rv.reshape(-1, 3), grid_faces(10, 20, close_u=True) + [tuple((9 * 20 + k, 9 * 20 + (k + 1) % 20, (k + 1) % 20, k)) for k in range(20)])
        ring.data.materials.append(mat_bronze())
        # 메달 (디스크, 가장자리 둥글게)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=48, radius1=0.0215, radius2=0.0215, depth=0.0022)
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6], offset=0.0006, segments=2, affect='EDGES')
        me = bpy.data.meshes.new('Pinky_Medal')
        bm.to_mesh(me); bm.free()
        for p in me.polygons:
            p.use_smooth = True
        medal = bpy.data.objects.new('Pinky_Medal', me)
        bpy.context.scene.collection.objects.link(medal)
        medal.matrix_world = Matrix.Translation(Vector(medal_c)) @ Matrix.Rotation(math.radians(90), 4, 'Y')
        medal.data.materials.append(mat_bronze())
        # 메달 윗부분 작은 연결 고리
        for ob in (ring, medal):
            self.bone_parent(ob, 'spine3')
        self.objs['medal'] = medal
        self.objs['ring'] = ring

    # --- 털 ---------------------------------------------------------------
    def add_fur(self, ob, count, length, children, mat, clump=0.15, length_group=None):
        mod = ob.modifiers.new('Fur', 'PARTICLE_SYSTEM')
        psys = mod.particle_system
        st = psys.settings
        st.type = 'HAIR'
        st.count = count
        st.hair_length = length
        st.hair_step = 3
        st.use_advanced_hair = False                # 길이는 hair_length 로 결정 (advanced 모드는 속도로 길이가 정해짐)
        st.effector_weights.gravity = 0.35          # 털이 살짝 아래로 눕도록
        st.child_type = 'INTERPOLATED'
        st.child_percent = max(1, children // 2)
        st.rendered_child_count = children
        st.child_length = 1.0
        st.child_length_threshold = 0.0
        st.clump_factor = clump
        st.clump_shape = 0.2
        st.roughness_1 = 0.0012
        st.roughness_1_size = 0.5
        st.roughness_endpoint = 0.0015
        st.roughness_2 = 0.0008
        st.roughness_2_size = 0.3
        st.child_radius = 0.6
        st.root_radius = 0.9
        st.tip_radius = 0.0
        st.radius_scale = 0.00012
        st.use_close_tip = True
        st.render_type = 'PATH'
        st.display_step = 2
        st.render_step = 3
        st.material = len(ob.data.materials) + 1
        ob.data.materials.append(mat)
        if length_group:
            psys.vertex_group_length = length_group
        return psys

    def build(self):
        t = time.time()
        self.build_body()
        self.build_armature()
        self.build_ears()
        self.build_eyes()
        self.build_nose()
        self.build_collar()
        if self.fur:
            self.add_fur(self.body, count=int(14000 * self.fur_scale), length=0.016, children=16,
                         mat=mat_fur('pinky_fur_body'), clump=0.2, length_group='furlen')
        print(f'[build] done in {time.time() - t:.1f}s')

    # --- 포즈 -------------------------------------------------------------
    def reset_pose(self):
        for pb in self.arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()

    def apply_pose(self, pose='stand', head_yaw=0.0, head_pitch=0.0):
        """뼈 방향 지정 방식: 각 뼈의 목표 방향(월드) → 레스트 방향과의 최소 회전.
        head_yaw(+ = 왼쪽), head_pitch(+ = 위) 는 목/머리에 분배"""
        self.reset_pose()
        dirs = {}
        root_pos = BONE_HEAD['spine1'].copy()
        if pose == 'sit':
            def d(x, y, z):
                return V(x, y, z) / np.linalg.norm((x, y, z))
            dirs['spine1'] = d(0.72, 0, 0.69)
            dirs['spine2'] = d(0.78, 0, 0.63)
            dirs['spine3'] = d(0.90, 0, 0.44)
            dirs['neck'] = d(0.55, 0, 0.83)
            dirs['head'] = d(0.98, 0, 0.18)
            dirs['tail1'] = d(-0.75, 0.55, -0.35)
            dirs['tail2'] = d(-0.35, 0.93, -0.05)
            for s, g in (('L', 1), ('R', -1)):
                dirs['thigh.' + s] = d(0.88, g * 0.30, 0.12)
                dirs['shin.' + s] = d(-0.25, g * 0.20, -0.95)
                dirs['hpaw.' + s] = d(0.98, g * 0.10, -0.06)
                dirs['upperarm.' + s] = d(0.06, -g * 0.04, -1.0)
                dirs['forearm.' + s] = d(0.0, -g * 0.02, -1.0)
                dirs['fpaw.' + s] = d(0.82, g * 0.03, -0.57)
                dirs['ear.' + s] = d(0.10, g * 0.10, -0.99)
            root_pos = V(-0.02, 0, 0.10)
        # 머리 회전 분배 (yaw: 목 40% / 머리 60%, pitch: 목 35% / 머리 65%)
        def rot_dir(v, yaw, pitch):
            q = Quaternion((0, 0, 1), yaw) @ Quaternion((0, -1, 0), pitch)   # -Y 축 양의 회전 = 위로 들기
            return np.array(q @ Vector(v))
        for bname, fy, fp in (('neck', 0.4, 0.35), ('head', 1.0, 1.0)):
            base = dirs.get(bname, (BONE_TAIL[bname] - BONE_HEAD[bname]) / np.linalg.norm(BONE_TAIL[bname] - BONE_HEAD[bname]))
            dirs[bname] = rot_dir(base, head_yaw * fy, head_pitch * fp)
        if head_yaw or head_pitch or pose == 'sit':
            for s, g in (('L', 1), ('R', -1)):
                base = dirs.get('ear.' + s, (BONE_TAIL['ear.' + s] - BONE_HEAD['ear.' + s]))
                base = base / np.linalg.norm(base)
                # 귀는 뿌리가 두개골에 붙어 있으므로 머리와 함께 회전 (뺨 위에 그대로 드레이프됨)
                dirs['ear.' + s] = rot_dir(base, head_yaw, head_pitch * 1.0)
        # 순방향 운동학으로 월드 행렬 계산
        order = [b[0] for b in BONES]
        world_rot = {}
        world_head = {}
        for b in order:
            parent = BONE_PARENT[b]
            rest_dir = BONE_TAIL[b] - BONE_HEAD[b]
            rest_dir = rest_dir / np.linalg.norm(rest_dir)
            if parent is None:
                world_head[b] = root_pos
                Rp = np.eye(3)
            else:
                Rp = world_rot[parent]
                world_head[b] = world_head[parent] + Rp @ (BONE_HEAD[b] - BONE_HEAD[parent])
            if b in dirs:
                tgt = dirs[b] / np.linalg.norm(dirs[b])
                # 부모 회전을 포함한 전체 회전: rest_dir → tgt (최소 회전)
                q = Vector(rest_dir).rotation_difference(Vector(tgt))
                Rb = np.array(q.to_matrix())
                # 롤 보정: 좌우 대칭이 유지되도록 lateral 축이 Y 와 정렬되게 조정
                world_rot[b] = Rb
            else:
                world_rot[b] = Rp
        # 바닥 보정: 발이 바닥(z=0)에 닿도록 전체 평행이동
        paw_tips = []
        for b in order:
            if b.startswith('fpaw') or b.startswith('hpaw'):
                paw_tips.append((world_head[b] + world_rot[b] @ (BONE_TAIL[b] - BONE_HEAD[b]))[2])
                paw_tips.append(world_head[b][2])
        dz = -min(paw_tips) + (0.0 if pose == 'stand' else 0.0)
        if pose == 'sit':
            # 앉은 자세: 엉덩이 바닥 기준. 뒷발 바닥 접촉은 아래에서 보정됨
            pass
        for b in order:
            world_head[b] = world_head[b] + np.array((0, 0, dz))
        # 포즈 행렬 설정 (부모 → 자식 순)
        pbs = self.arm.pose.bones
        for b in order:
            rest = self.rest_local[b]
            rest_rot = rest.to_3x3()
            R = Matrix(world_rot[b].tolist()) @ rest_rot
            M = Matrix.Translation(Vector(world_head[b])) @ R.to_4x4()
            pbs[b].matrix = M
            bpy.context.view_layer.update()
        self.pose_info = dict(world_head=world_head, world_rot=world_rot)
        return world_head

# ----------------------------------------------------------------------------
# 8. 씬: 조명, 바닥(그림자 캐처), 카메라, 렌더 설정
# ----------------------------------------------------------------------------
def setup_scene(res_x, samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 6
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.cycles.hair_shape = 'ROUND_RIBBONS' if hasattr(sc.cycles, 'hair_shape') else None
    try:
        sc.cycles_curves.shape = 'RIBBONS'
        sc.cycles_curves.subdivisions = 2
    except Exception:
        pass
    sc.render.resolution_x = res_x
    sc.render.resolution_y = int(round(res_x * 2 / 3))
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.render.threads_mode = 'AUTO'
    # 월드: 부드러운 회색 환경광
    w = bpy.data.worlds.new('World'); sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.45, 0.45, 0.47, 1)
    bg.inputs['Strength'].default_value = 0.45
    # 바닥: 그림자 캐처 (배경 회색 위에 그림자만 합성)
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6)
    me = bpy.data.meshes.new('Floor'); bm.to_mesh(me); bm.free()
    floor = bpy.data.objects.new('Floor', me); sc.collection.objects.link(floor)
    floor.data.materials.append(mat_floor())
    floor.is_shadow_catcher = True
    # 컴포지터: 회색 배경 위에 알파오버
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers')
    rgb = nt.nodes.new('CompositorNodeRGB')
    rgb.outputs[0].default_value = (*srgb_to_lin(COL['bg']), 1)
    ao = nt.nodes.new('CompositorNodeAlphaOver')
    comp = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(rgb.outputs[0], ao.inputs[1])
    nt.links.new(rl.outputs['Image'], ao.inputs[2])
    nt.links.new(ao.outputs[0], comp.inputs[0])
    # 조명 (카메라 기준으로 place_lights 에서 배치)
    lights = {}
    for name, power, size in (('Key', 260, 1.8), ('Fill', 90, 2.5), ('Rim', 120, 1.2), ('Top', 50, 3.0)):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy = power; ld.size = size
        ld.color = (1.0, 0.98, 0.95) if name == 'Key' else (0.95, 0.97, 1.0)
        lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo)
        lights[name] = lo
    cam_d = bpy.data.cameras.new('Cam')
    cam_d.lens = 70
    cam_d.sensor_width = 36
    cam = bpy.data.objects.new('Cam', cam_d); sc.collection.objects.link(cam)
    sc.camera = cam
    return cam, lights

def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def place_camera(cam, azim_deg, elev_deg, dist, target, lens=70):
    """azim: 개의 앞(+X)에서 반시계(왼쪽 +Y) 방향 각도. elev: 수평 대비 고도"""
    a, e = math.radians(azim_deg), math.radians(elev_deg)
    cam.location = Vector(target) + Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))) * dist
    look_at(cam, target)
    cam.data.lens = lens

def place_lights(lights, azim_deg, target):
    """카메라 방위 기준 스튜디오 3점 조명: 키(카메라 좌측 위), 필(우측), 림(뒤쪽 위), 탑"""
    a = math.radians(azim_deg)
    def pos(da, elev, dist):
        aa = a + math.radians(da); ee = math.radians(elev)
        return Vector(target) + Vector((math.cos(aa) * math.cos(ee), math.sin(aa) * math.cos(ee), math.sin(ee))) * dist
    lights['Key'].location = pos(+40, 42, 2.4)
    lights['Fill'].location = pos(-55, 18, 2.8)
    lights['Rim'].location = pos(+165, 48, 2.6)
    lights['Top'].location = pos(0, 85, 3.0)
    for lo in lights.values():
        look_at(lo, target)

def render_to(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'[render] {os.path.basename(path)} {time.time() - t:.0f}s')

# 레퍼런스 4 뷰 정의: (파일명, 포즈, 머리 yaw, 머리 pitch, 카메라 방위, 고도, 거리, 타깃, 렌즈)
REF_VIEWS = {
    'v1': ('ref_v1_stand_front34.png', 'stand', -0.55, -0.05, -58, 9, 1.8, (0.21, -0.02, 0.255), 85),
    'v2': ('ref_v2_stand_rear34.png', 'stand', 0.75, 0.0, 140, 10, 1.8, (0.12, 0.03, 0.25), 85),
    'v3': ('ref_v3_sit_34.png', 'sit', -0.45, 0.35, -62, 4, 1.75, (0.13, -0.03, 0.25), 85),
    'v4': ('ref_v4_sit_front.png', 'sit', 0.0, 0.05, -4, 6, 1.6, (0.12, 0.0, 0.29), 85),
    # 디버그용 근접 뷰
    'face': ('dbg_face.png', 'stand', 0.0, 0.0, -5, 5, 0.9, (0.45, 0.0, 0.43), 85),
    'side': ('dbg_side.png', 'stand', 0.0, 0.0, -90, 2, 2.2, (0.20, 0.0, 0.24), 85),
    'top': ('dbg_top.png', 'stand', 0.0, 0.0, -90, 88, 2.2, (0.20, 0.0, 0.24), 85),
    'headside': ('dbg_headside.png', 'stand', 0.0, 0.0, -90, 3, 0.9, (0.44, 0.0, 0.43), 85),
}

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam, lights = setup_scene(ARGS.res, ARGS.samples)
    dog = Pinky(fur=not ARGS.no_fur, fur_scale=ARGS.fur_scale)
    out = os.path.abspath(ARGS.out)
    os.makedirs(out, exist_ok=True)
    views = ARGS.views
    if views in ('ref', 'all'):
        only = ARGS.only.split(',') if ARGS.only else ['v1', 'v2', 'v3', 'v4']
        for key in only:
            fn, pose, yaw, pitch, az, el, dist, tgt, lens = REF_VIEWS[key]
            wh = dog.apply_pose(pose, head_yaw=yaw, head_pitch=pitch)
            if key in ('v3',):
                print('[pose sit] joints:', {k: np.round(v, 3).tolist() for k, v in wh.items() if k in ('spine1', 'spine3', 'neck', 'head', 'thigh.L', 'shin.L', 'hpaw.L', 'upperarm.L', 'fpaw.L')})
            place_camera(cam, az, el, dist, tgt, lens)
            place_lights(lights, az, tgt)
            render_to(os.path.join(out, fn))
    if views in ('turntable', 'all'):
        dog.apply_pose('stand', head_yaw=0.0, head_pitch=0.0)
        tgt = (0.17, 0.0, 0.23)
        n = ARGS.frames
        for i in range(n):
            az = -60 + 360.0 * i / n
            place_camera(cam, az, 10, 1.9, tgt, 70)
            place_lights(lights, az, tgt)
            render_to(os.path.join(out, f'turntable_{i:02d}.png'))
    # 저장/내보내기는 기본 포즈로
    dog.apply_pose(ARGS.pose)
    place_camera(cam, -52, 9, 1.75, (0.2, 0, 0.235), 85)
    place_lights(lights, -52, (0.2, 0, 0.235))
    if ARGS.export_glb:
        try:
            bpy.ops.object.select_all(action='DESELECT')
            for ob in [dog.body, dog.arm] + list(dog.objs.values()):
                ob.select_set(True)
            kw = dict(filepath=os.path.abspath(ARGS.export_glb), export_format='GLB',
                      use_selection=True, export_apply=True, export_yup=True,
                      export_animations=False, export_skins=True, export_image_format='AUTO')
            try:
                bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)   # 버텍스 컬러(삼색 무늬/눈) 항상 포함
            except TypeError:
                bpy.ops.export_scene.gltf(**kw)
            print('[glb] exported', ARGS.export_glb)
        except Exception as ex:
            print('[glb] export failed:', ex)
    if ARGS.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(ARGS.save_blend))
        print('[blend] saved', ARGS.save_blend)

if __name__ == '__main__':
    main()
