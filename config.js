/*
 * StandOrt — Konfiguration
 *
 * Trag hier die Zugangsdaten deines Supabase-Projekts ein, damit StandOrt die
 * Standorte zwischen Leandra und Arno teilt (statt nur lokal im Browser).
 *
 *   supabaseUrl     = die Projekt-URL, z.B. "https://abcxyz.supabase.co"
 *   supabaseAnonKey = der "anon public"-Key aus den Projekt-Einstellungen
 *
 * BEIDE FELDER LEER  → Demo-Modus: alles läuft lokal im Browser (localStorage),
 *                      mit Beispieldaten, ohne Login, nichts wird geteilt.
 *
 * Der anon-Key DARF öffentlich im Repo stehen. Er erlaubt für sich genommen
 * keinen Datenzugriff: Row Level Security (siehe db/setup.sql) lässt nur
 * eingeloggte, in allowed_users freigeschaltete E-Mail-Adressen an die Daten.
 * ECHTE Geheimnisse (service_role-Key, Passwörter) gehören NIE ins Repo.
 *
 *   shouldCreateUser = true  → beim Login dürfen neue Konten entstehen (nötig,
 *                              bis Leandra und Arno sich je einmal angemeldet
 *                              haben). DANACH auf false setzen, dann kann sich
 *                              keine fremde Adresse mehr ein Konto anlegen.
 */
window.STANDORT_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  shouldCreateUser: true
};
