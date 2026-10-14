"""Pure candidate heuristics. No semantic certainty from pixels."""
import itertools
import numpy as np
from PIL import Image

def classify(image):
    small=image.convert('L');small.thumbnail((900,900))
    ink=np.asarray(small)<180
    horizontal=int((ink.mean(axis=1)>.65).sum())
    vertical=int((ink.mean(axis=0)>.65).sum())
    density=float(ink.mean())
    if density<.002:kind='unknown'
    elif horizontal>5 and vertical>5:kind='grid_form'
    elif horizontal>2 and vertical>1:kind='quantity_table'
    elif max(image.size)/min(image.size)>2 or (density<.04 and horizontal+vertical>2):kind='drawing'
    else:
        rp=ink.mean(axis=1);gaps=int(np.count_nonzero(np.diff(rp<.01)))
        kind='continuous_text' if gaps>=12 else 'unknown'
    return {'candidate':kind,'status':'candidate_only','features':{'long_horizontal_pixels':horizontal,'long_vertical_pixels':vertical,'ink_density':density},'limitation':'Pixels do not establish table semantics; dense quantity tables may resemble forms.'}

def orientation(image,clockwise=None):
    if clockwise is not None:
        if clockwise not in (0,90,180,270):raise ValueError('orientation must be 0/90/180/270')
        transpose={0:None,90:Image.Transpose.ROTATE_270,180:Image.Transpose.ROTATE_180,270:Image.Transpose.ROTATE_90}[clockwise]
        return image.copy() if transpose is None else image.transpose(transpose),{'status':'explicit_override','clockwise':clockwise,'candidates':[clockwise]}
    small=image.convert('L');small.thumbnail((900,900));ink=np.asarray(small)<180
    a=float(np.square(np.diff(ink.sum(axis=1).astype(float))).sum());b=float(np.square(np.diff(ink.sum(axis=0).astype(float))).sum())
    candidates=[0,180] if a>1.25*max(b,1) else [90,270] if b>1.25*max(a,1) else [0,90,180,270]
    return image.copy(),{'status':'unresolved','clockwise':None,'candidates':candidates,'axis_scores':[a,b],'limitation':'Projection cannot disambiguate upright/upside-down. No automatic rotation or inference until explicit resolution.'}

def deskew(image):
    small=image.convert('L');small.thumbnail((900,900))
    def score(angle):
        arr=np.asarray(small.rotate(angle,resample=Image.Resampling.BILINEAR,expand=False,fillcolor=255))<180
        h,w=arr.shape;arr=arr[max(1,h//20):-max(1,h//20),max(1,w//20):-max(1,w//20)]
        return float(np.square(np.diff(arr.sum(axis=1).astype(float))).sum()) if arr.size else 0.
    angles=[-2+i*.1 for i in range(41)];scores=[score(a) for a in angles];angle=angles[int(np.argmax(scores))];ratio=max(scores)/max(scores[20],1)
    apply=ratio>=1.10 and .09<=abs(angle)<1.95
    return (image.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True,fillcolor='white') if apply else image.copy()),{'candidate_ccw':angle,'applied_ccw':angle if apply else 0,'score_ratio':ratio,'status':'applied_heuristic' if apply else 'not_applied','policy':'pas4 projection; thumbnail measurement only; full raster rotation'}

def text_bands(image):
    a=np.asarray(image.convert('L'));h,w=a.shape;v=(a[:,int(w*.08):int(w*.92)]<200).sum(axis=1)
    edges=np.flatnonzero(np.diff(np.r_[False,v==0,False]));gaps=[(int(l),int(r)) for l,r in zip(edges[::2],edges[1::2]) if r-l>=3];mid=[(l+r)//2 for l,r in gaps]
    safe=[i for i in range(1,len(gaps)-1) if 0<gaps[i][0]-gaps[i-1][1]<=65 and 0<gaps[i+1][0]-gaps[i][1]<=65]
    chosen=None
    for n in (3,4):
        options=[[i for i in safe if abs(mid[i]-h*j/n)<=h*.15] for j in range(1,n)]
        # Bounded candidate enumeration: score per choice; monotone DP avoids
        # combinatorial products on tall documents while preserving objective.
        paths={}
        for j,opts in enumerate(options):
            new={}
            for i in opts:
                cost=abs(mid[i]-h*(j+1)/n)
                if j==0:new[i]=(cost,(i,))
                else:
                    valid=[(c+cost,xs+(i,)) for prev,(c,xs) in paths.items() if i>prev+2]
                    if valid:new[i]=min(valid)
            paths=new
        if paths:chosen=min(paths.values())[1];break
    line_runs=[[gaps[k][1],gaps[k+1][0]] for k in range(len(gaps)-1) if gaps[k+1][0]>gaps[k][1]]
    if chosen is None:return [{'box':[0,0,w,h],'core_y':[0,h]}],{'mode':'whole_page_fallback','reason':'no_safe_pas6_cuts','line_runs':line_runs}
    cores=[0]+[mid[i] for i in chosen]+[h];bands=[]
    for j in range(n):
        top=0 if j==0 else mid[chosen[j-1]-1];bottom=h if j==n-1 else mid[chosen[j]+1]
        bands.append({'box':[0,top,w,bottom],'core_y':[cores[j],cores[j+1]]})
    return bands,{'mode':'pas6_white_gaps','overlap':'two complete detected ink runs; not visual certification','line_runs':line_runs}
