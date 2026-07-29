export function findSceneAtTime(project, time) {
  return (project.scenes || []).find((scene) => time >= scene.start && time < scene.end) || null;
}
