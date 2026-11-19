// Registre des routes : /api/<nom>.php (ou /api/<nom>) -> serveur/routes/<nom>.js.
// Import STATIQUE de chaque route : Vercel n'inclut dans la fonction que les fichiers (et paquets npm) qu'il peut suivre
// depuis le point d'entrée ; un import dynamique ne serait pas suivi (bcryptjs et pg manqueraient en production).
// tests/api-vercel/routes-registre.test.mjs vérifie qu'aucune route du dossier n'est oubliée ici.
import availability from './routes/availability.js';
import customer_login from './routes/customer_login.js';
import customer_logout from './routes/customer_logout.js';
import customer_me from './routes/customer_me.js';
import customer_orders from './routes/customer_orders.js';
import customer_signup from './routes/customer_signup.js';
import customer_update_address from './routes/customer_update_address.js';
import customer_update_profile from './routes/customer_update_profile.js';
import order_create from './routes/order_create.js';
import order_status from './routes/order_status.js';
import owner_availability from './routes/owner_availability.js';
import owner_customers from './routes/owner_customers.js';
import owner_login from './routes/owner_login.js';
import owner_logout from './routes/owner_logout.js';
import owner_me from './routes/owner_me.js';
import owner_order_decide from './routes/owner_order_decide.js';
import owner_orders from './routes/owner_orders.js';
import owner_sessions from './routes/owner_sessions.js';
import owner_sessions_revoke from './routes/owner_sessions_revoke.js';
import owner_settings from './routes/owner_settings.js';

export const ROUTES = {
  availability,
  customer_login,
  customer_logout,
  customer_me,
  customer_orders,
  customer_signup,
  customer_update_address,
  customer_update_profile,
  order_create,
  order_status,
  owner_availability,
  owner_customers,
  owner_login,
  owner_logout,
  owner_me,
  owner_order_decide,
  owner_orders,
  owner_sessions,
  owner_sessions_revoke,
  owner_settings
};
