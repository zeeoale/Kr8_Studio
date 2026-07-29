export function findAssetByRole(project, role) {
  return (project.assets || []).find((asset) => asset.role === role) || null;
}

export function listMissingAssets(project) {
  return (project.assets || []).filter((asset) => asset.missing);
}
