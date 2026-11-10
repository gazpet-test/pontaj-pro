// nodSchema3dThree.js — DOAR clasele Three.js folosite de NodSchema3D.jsx. Se încarcă prin import dinamic (fișier separat la build),
// iar importul pe nume lasă build-ul să arunce restul pachetului (un `import('three')` direct ar aduce tot Three.js).
export {
  WebGLRenderer, Scene, AmbientLight, HemisphereLight, DirectionalLight, MeshStandardMaterial, MeshBasicMaterial, SpriteMaterial,
  Group, Vector3, Mesh, CylinderGeometry, SphereGeometry, TubeGeometry, PlaneGeometry, QuadraticBezierCurve3, CanvasTexture, Sprite,
  GridHelper, PerspectiveCamera, SRGBColorSpace, DoubleSide, BackSide,
} from 'three'
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
export { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
