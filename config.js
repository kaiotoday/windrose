/*
 * Windrose — Konfiguration
 *
 * Trag hier die Zugangsdaten deines Supabase-Projekts ein, damit Windrose die
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
  supabaseUrl: "https://vbtucmcgroxqnsrjmrgv.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZidHVjbWNncm94cW5zcmptcmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzE4MjcsImV4cCI6MjEwMDMwNzgyN30.JW-E98w-UfFCN_8Z0Aq2rd-QFoT2EBQ5wlPJC4Xc9qw",
  shouldCreateUser: true
};
