// Bloque l'accès public direct au code source serveur : ces fichiers doivent rester dans le
// déploiement (requis par functions.includeFiles dans vercel.json pour que les fonctions API
// puissent les importer), donc .vercelignore ne peut pas les exclure — ce middleware les rend
// inaccessibles en HTTP sans les retirer du déploiement.
export default function middleware() {
  return new Response('Not Found', { status: 404 });
}

export const config = {
  matcher: ['/serveur', '/serveur/:path*'],
};
