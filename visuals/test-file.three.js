// title: Rotating Cube — quick test (no imports)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

// cube
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshNormalMaterial();
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);
camera.position.z = 3;

function animate(){
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();

// optional: react a bit to audio rms if present
if (typeof METRICS !== 'undefined'){
  const orig = material.clone();
  (function pulse(){
    requestAnimationFrame(pulse);
    const s = 1 + (METRICS.rms||0) * 4;
    cube.scale.set(s,s,s);
  })();
}
