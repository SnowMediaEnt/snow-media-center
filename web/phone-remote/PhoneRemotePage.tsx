// snowmediaent.com/remote — a phone as the Snow Media Center remote.
//
// Self-contained page for the website (Snow Media Launchpad): it talks to the
// Snow Media Center backend (not the website's own), using its public key.
//   1. The TV shows an 8-letter code and a QR (Settings → Phone Remote, or
//      the card next to any text box). The QR opens this page with ?c=CODE.
//   2. The phone-remote function takes the code (each works once) and asks
//      the TV, which shows "Allow this phone?". Once the TV's own remote says
//      Allow, the phone collects the TV's pairing and remembers it, so next
//      time it just connects.
//   3. Buttons, typing and voice go to the TV over the Realtime channel
//      "smc-remote:<secret>" (event "phone"); the TV answers on event "box"
//      (ready, the text box it has open, away, unpaired). Messages wait while
//      the channel (re)connects, and it reconnects on its own.
//
// Needs: react, @supabase/supabase-js, lucide-react, Tailwind. Route it at
// /remote (and /r). Keep this file as it is in the SMC repo
// (web/phone-remote/PhoneRemotePage.tsx) so both sides stay in step: the TV
// app and the phone-remote function of the same release expect this version.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { RealtimeClient, createClient, type RealtimeChannel } from '@supabase/supabase-js';
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FastForward, Home, Keyboard, Loader2,
  Menu, Mic, Pause, Rewind, Smartphone, Tv, Unlink,
} from 'lucide-react';

// The Snow Media Center backend — its public (publishable) key, the same one
// the TV app ships with.
const SMC_URL = 'https://falmwzhvxoefvkfsiylp.supabase.co';
const SMC_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';

const STORE_KEY = 'smc-phone-remote';
const HELLO_EVERY_MS = 30_000;
/** No word from the TV this long after a hello: it isn't answering. */
const REPLY_WITHIN_MS = 8_000;
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 140;
/** Presses held while the channel reconnects are sent if still this fresh. */
const QUEUE_KEEP_MS = 15_000;
const CLAIM_EVERY_MS = 2_500;
const CLAIM_GIVE_UP_MS = 150_000;
/** Longest the mic listens before it stops by itself. */
const VOICE_MAX_MS = 10_000;
/** A pause this long after words means they're done (Safari may never say "final"). */
const VOICE_PAUSE_MS = 1_500;

// Codes: 8 letters from these consonants (the TV shows them as ABCD-EFGH).
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const cleanCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z]/g, '').split('').filter((ch) => CODE_ALPHABET.includes(ch)).join('').slice(0, 8);
/** An example of what the code looks like: not text to translate. */
const SAMPLE_CODE = 'BCDF-GHJK';
/** The pad's middle key carries the same word as the TV remote's. */
const OK_KEY = 'OK';
const showCode = (c: string) => (c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);

interface Pairing { secret: string; label: string; id: string }

// One client for the page's calls, separate from the website's own sign-in.
// The channel gets a Realtime connection of its own, made new on every
// reconnect: a socket a phone slept on can look alive for a minute, and a
// channel being left can't be joined again under the same name.
let smc: ReturnType<typeof createClient> | null = null;
const newRealtime = () => new RealtimeClient(`${SMC_URL.replace(/^http/, 'ws')}/realtime/v1`, { params: { apikey: SMC_ANON_KEY } });
const client = () => (smc ??= createClient(SMC_URL, SMC_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'smc-phone-remote-auth' } }));
const call = async (body: Record<string, unknown>) => {
  const { data, error } = await client().functions.invoke('phone-remote', { body });
  if (error) throw error;
  return (data ?? {}) as { ok?: boolean; reason?: string; [k: string]: unknown };
};

const loadPairing = (): Pairing | null => {
  try { const p = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return p && /^[0-9a-f]{64}$/.test(p.secret) ? p : null; } catch { return null; }
};
const savePairing = (p: Pairing | null) => {
  try { if (p) localStorage.setItem(STORE_KEY, JSON.stringify(p)); else localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
};
const codeFromUrl = () => { try { return cleanCode(new URLSearchParams(window.location.search).get('c') || ''); } catch { return ''; } };
const clearUrl = () => { try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ } };
const buzz = () => { try { navigator.vibrate?.(12); } catch { /* not supported */ } };
const newId = () => {
  try { const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); } catch { return Math.random().toString(36).slice(2, 12); }
};

type SpeechResults = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
type Speech = {
  start: () => void; stop: () => void; abort?: () => void;
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: SpeechResults }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};
const speechCtor = (): (new () => Speech) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Speech; webkitSpeechRecognition?: new () => Speech };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// ── language ───────────────────────────────────────────────────────────────
// The page follows the TV's language, not the phone's: the TV puts it in the QR
// address (?lang=xx). The page is served on its own and cannot share the app's
// translation files, so it carries its own small dictionary. Arabic is text only:
// the page stays left to right, like the TV.
type Lang = 'en' | 'es' | 'fr' | 'de' | 'ar';
const LANGS: Lang[] = ['en', 'es', 'fr', 'de', 'ar'];
const LANG_KEY = 'smc-phone-remote-lang';

const EN = {
  title: 'Snow Media Remote',
  tooManyTries: 'Too many tries from this network. Wait ten minutes and try again.',
  busy: 'A lot of phones are pairing right now. Try again in a minute.',
  wrongCode: "That code didn't work. Check the code on the TV — each code works once.",
  badCode: 'The code is 8 letters, like BCDF-GHJK.',
  connectFailed: "Couldn't connect. Check your internet and try again.",
  switchTitle: 'Pair with a different TV?',
  switchText: 'This phone is already the remote for “{{label}}”. Pairing with the TV showing code {{code}} replaces it.',
  switchPair: 'Pair with the new TV',
  switchKeep: 'Keep using “{{label}}”',
  pairHelp: 'On your TV, open Snow Media Center → Settings → Phone Remote, then scan the QR code or type the 8-letter code here.',
  codeAria: 'Code shown on the TV',
  connect: 'Connect',
  backTo: 'Back to “{{label}}”',
  denied: "The TV didn't allow this phone.",
  expired: "The TV didn't answer in time. Enter the new code on the TV to try again.",
  almostTitle: 'Almost there',
  almostText: "“{{label}}” is asking whether to allow this phone. Choose <b>Allow</b> with the TV's remote (press OK).",
  cancel: 'Cancel',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  unpairedByTv: 'This TV unpaired its phones. Pair again with the new code on the TV.',
  forget: 'Forget',
  quiet: "The TV isn't answering. Make sure Snow Media Center is open on it — the remote works while the app is on screen.",
  away: "Another app is on the TV screen. Use the TV's own remote to get back to Snow Media Center — this remote works while it's on screen.",
  back: 'Back',
  home: 'Home',
  options: 'Options',
  textBoxOpen: '<b>A text box is open on the TV</b>. Tap to type it here.',
  textBoxOpenNamed: '<b>A text box is open on the TV</b><i> (“{{label}}”)</i>. Tap to type it here.',
  rewind: 'Rewind',
  playPause: 'Play/Pause',
  forward: 'Forward',
  keyboard: 'Keyboard',
  voice: 'Voice',
  listening: 'Listening… tap to stop',
  voiceOff: 'Voice (not on this phone)',
  voiceUnavailable: "Voice isn't available in this browser.",
  didntCatch: "Didn't catch that. Tap the mic and try again.",
  micBlocked: 'The microphone is blocked. Allow it for this site in your browser settings, then try again.',
  noMic: 'No microphone was found on this phone.',
  voiceNetwork: 'Voice needs an internet connection. Try again.',
  voiceStopped: 'Voice stopped. Tap the mic to try again.',
  micStartFailed: "Couldn't start the microphone. Try again.",
  tvBox: 'TV text box',
  tvBoxNamed: 'TV text box: “{{label}}”',
  tvBoxPassword: 'TV text box (a password: what you type goes to the TV)',
  tvBoxNamedPassword: 'TV text box: “{{label}}” (a password: what you type goes to the TV)',
  pickBox: 'Pick a text box on the TV (a search or sign-in box), then type here.',
  typeHere: 'Type here',
  go: 'Go',
};
type Key = keyof typeof EN;

const ES: Record<Key, string> = {
  title: 'Control remoto Snow Media',
  tooManyTries: 'Demasiados intentos desde esta red. Espera diez minutos e inténtalo de nuevo.',
  busy: 'Hay muchos teléfonos vinculándose ahora. Inténtalo de nuevo en un minuto.',
  wrongCode: 'Ese código no funcionó. Revisa el código en la TV: cada código sirve una sola vez.',
  badCode: 'El código tiene 8 letras, como BCDF-GHJK.',
  connectFailed: 'No se pudo conectar. Revisa tu internet e inténtalo de nuevo.',
  switchTitle: '¿Vincular con otra TV?',
  switchText: 'Este teléfono ya es el control remoto de “{{label}}”. Al vincularlo con la TV que muestra el código {{code}}, se reemplaza.',
  switchPair: 'Vincular con la TV nueva',
  switchKeep: 'Seguir con “{{label}}”',
  pairHelp: 'En tu TV, abre Snow Media Center → Ajustes → Control desde el celular, y luego escanea el código QR o escribe aquí el código de 8 letras.',
  codeAria: 'Código que aparece en la TV',
  connect: 'Conectar',
  backTo: 'Volver a “{{label}}”',
  denied: 'La TV no permitió este teléfono.',
  expired: 'La TV no respondió a tiempo. Escribe el código nuevo de la TV para intentarlo de nuevo.',
  almostTitle: 'Casi listo',
  almostText: '“{{label}}” está preguntando si permite este teléfono. Elige <b>Permitir</b> con el control remoto de la TV (pulsa OK).',
  cancel: 'Cancelar',
  up: 'Arriba',
  down: 'Abajo',
  left: 'Izquierda',
  right: 'Derecha',
  unpairedByTv: 'Esta TV desvinculó sus teléfonos. Vuelve a vincular con el código nuevo de la TV.',
  forget: 'Olvidar',
  quiet: 'La TV no responde. Asegúrate de que Snow Media Center esté abierto en ella: el control funciona mientras la app está en pantalla.',
  away: 'Hay otra app en la pantalla de la TV. Usa el control remoto de la TV para volver a Snow Media Center: este control funciona mientras esté en pantalla.',
  back: 'Atrás',
  home: 'Inicio',
  options: 'Opciones',
  textBoxOpen: '<b>Hay un cuadro de texto abierto en la TV</b>. Toca para escribir aquí.',
  textBoxOpenNamed: '<b>Hay un cuadro de texto abierto en la TV</b><i> (“{{label}}”)</i>. Toca para escribir aquí.',
  rewind: 'Retroceder',
  playPause: 'Reproducir/Pausa',
  forward: 'Avanzar',
  keyboard: 'Teclado',
  voice: 'Voz',
  listening: 'Escuchando… toca para parar',
  voiceOff: 'Voz (no disponible en este teléfono)',
  voiceUnavailable: 'La voz no está disponible en este navegador.',
  didntCatch: 'No te entendí. Toca el micrófono e inténtalo de nuevo.',
  micBlocked: 'El micrófono está bloqueado. Permítelo para este sitio en los ajustes del navegador y vuelve a intentarlo.',
  noMic: 'No se encontró ningún micrófono en este teléfono.',
  voiceNetwork: 'La voz necesita conexión a internet. Inténtalo de nuevo.',
  voiceStopped: 'La voz se detuvo. Toca el micrófono para intentarlo de nuevo.',
  micStartFailed: 'No se pudo iniciar el micrófono. Inténtalo de nuevo.',
  tvBox: 'Cuadro de texto de la TV',
  tvBoxNamed: 'Cuadro de texto de la TV: “{{label}}”',
  tvBoxPassword: 'Cuadro de texto de la TV (una contraseña: lo que escribas va a la TV)',
  tvBoxNamedPassword: 'Cuadro de texto de la TV: “{{label}}” (una contraseña: lo que escribas va a la TV)',
  pickBox: 'Elige un cuadro de texto en la TV (de búsqueda o de inicio de sesión) y escribe aquí.',
  typeHere: 'Escribe aquí',
  go: 'Ir',
};

const FR: Record<Key, string> = {
  title: 'Télécommande Snow Media',
  tooManyTries: 'Trop de tentatives depuis ce réseau. Patientez dix minutes puis réessayez.',
  busy: 'Beaucoup de téléphones se jumellent en ce moment. Réessayez dans une minute.',
  wrongCode: "Ce code n'a pas fonctionné. Vérifiez le code sur la TV : chaque code ne sert qu'une fois.",
  badCode: 'Le code comporte 8 lettres, comme BCDF-GHJK.',
  connectFailed: 'Connexion impossible. Vérifiez votre connexion internet et réessayez.',
  switchTitle: 'Jumeler avec une autre TV ?',
  switchText: 'Ce téléphone est déjà la télécommande de « {{label}} ». Le jumeler avec la TV qui affiche le code {{code}} le remplace.',
  switchPair: 'Jumeler avec la nouvelle TV',
  switchKeep: 'Garder « {{label}} »',
  pairHelp: 'Sur votre TV, ouvrez Snow Media Center → Paramètres → Télécommande mobile, puis scannez le code QR ou saisissez ici le code à 8 lettres.',
  codeAria: 'Code affiché sur la TV',
  connect: 'Se connecter',
  backTo: 'Retour à « {{label}} »',
  denied: "La TV n'a pas autorisé ce téléphone.",
  expired: "La TV n'a pas répondu à temps. Saisissez le nouveau code de la TV pour réessayer.",
  almostTitle: 'Presque terminé',
  almostText: '« {{label}} » demande s\'il faut autoriser ce téléphone. Choisissez <b>Autoriser</b> avec la télécommande de la TV (appuyez sur OK).',
  cancel: 'Annuler',
  up: 'Haut',
  down: 'Bas',
  left: 'Gauche',
  right: 'Droite',
  unpairedByTv: 'Cette TV a déconnecté ses téléphones. Jumelez à nouveau avec le nouveau code de la TV.',
  forget: 'Oublier',
  quiet: "La TV ne répond pas. Vérifiez que Snow Media Center est ouvert dessus : la télécommande fonctionne tant que l'app est à l'écran.",
  away: "Une autre app est affichée sur la TV. Utilisez la télécommande de la TV pour revenir à Snow Media Center : cette télécommande fonctionne tant qu'il est à l'écran.",
  back: 'Retour',
  home: 'Accueil',
  options: 'Options',
  textBoxOpen: '<b>Un champ de texte est ouvert sur la TV</b>. Touchez pour saisir ici.',
  textBoxOpenNamed: '<b>Un champ de texte est ouvert sur la TV</b><i> (« {{label}} »)</i>. Touchez pour saisir ici.',
  rewind: 'Rembobiner',
  playPause: 'Lecture/Pause',
  forward: 'Avancer',
  keyboard: 'Clavier',
  voice: 'Voix',
  listening: 'Écoute… touchez pour arrêter',
  voiceOff: 'Voix (indisponible sur ce téléphone)',
  voiceUnavailable: "La voix n'est pas disponible dans ce navigateur.",
  didntCatch: "Je n'ai pas compris. Touchez le micro et réessayez.",
  micBlocked: "Le microphone est bloqué. Autorisez-le pour ce site dans les réglages du navigateur, puis réessayez.",
  noMic: "Aucun microphone n'a été trouvé sur ce téléphone.",
  voiceNetwork: 'La voix nécessite une connexion internet. Réessayez.',
  voiceStopped: "La voix s'est arrêtée. Touchez le micro pour réessayer.",
  micStartFailed: 'Impossible de démarrer le microphone. Réessayez.',
  tvBox: 'Champ de texte de la TV',
  tvBoxNamed: 'Champ de texte de la TV : « {{label}} »',
  tvBoxPassword: 'Champ de texte de la TV (un mot de passe : ce que vous saisissez va vers la TV)',
  tvBoxNamedPassword: 'Champ de texte de la TV : « {{label}} » (un mot de passe : ce que vous saisissez va vers la TV)',
  pickBox: 'Choisissez un champ de texte sur la TV (recherche ou connexion), puis saisissez ici.',
  typeHere: 'Saisissez ici',
  go: 'OK',
};

const DE: Record<Key, string> = {
  title: 'Snow Media Fernbedienung',
  tooManyTries: 'Zu viele Versuche aus diesem Netzwerk. Warte zehn Minuten und versuche es dann erneut.',
  busy: 'Gerade koppeln viele Handys. Versuche es in einer Minute erneut.',
  wrongCode: 'Dieser Code hat nicht funktioniert. Prüfe den Code am Fernseher – jeder Code gilt nur einmal.',
  badCode: 'Der Code besteht aus 8 Buchstaben, z. B. BCDF-GHJK.',
  connectFailed: 'Verbindung nicht möglich. Prüfe dein Internet und versuche es erneut.',
  switchTitle: 'Mit einem anderen Fernseher koppeln?',
  switchText: 'Dieses Handy ist bereits die Fernbedienung für „{{label}}“. Wenn du es mit dem Fernseher koppelst, der den Code {{code}} zeigt, wird sie ersetzt.',
  switchPair: 'Mit dem neuen Fernseher koppeln',
  switchKeep: '„{{label}}“ weiter verwenden',
  pairHelp: 'Öffne auf deinem Fernseher Snow Media Center → Einstellungen → Handy-Fernbedienung, scanne dann den QR-Code oder gib hier den Code mit 8 Buchstaben ein.',
  codeAria: 'Am Fernseher angezeigter Code',
  connect: 'Verbinden',
  backTo: 'Zurück zu „{{label}}“',
  denied: 'Der Fernseher hat dieses Handy nicht erlaubt.',
  expired: 'Der Fernseher hat nicht rechtzeitig geantwortet. Gib den neuen Code vom Fernseher ein, um es erneut zu versuchen.',
  almostTitle: 'Fast geschafft',
  almostText: '„{{label}}“ fragt, ob dieses Handy erlaubt werden soll. Wähle mit der Fernbedienung des Fernsehers <b>Erlauben</b> (OK drücken).',
  cancel: 'Abbrechen',
  up: 'Hoch',
  down: 'Runter',
  left: 'Links',
  right: 'Rechts',
  unpairedByTv: 'Dieser Fernseher hat seine Handys getrennt. Koppel erneut mit dem neuen Code am Fernseher.',
  forget: 'Vergessen',
  quiet: 'Der Fernseher antwortet nicht. Prüfe, ob Snow Media Center dort geöffnet ist – die Fernbedienung funktioniert, solange die App im Bild ist.',
  away: 'Eine andere App ist auf dem Fernseher zu sehen. Nutze die Fernbedienung des Fernsehers, um zu Snow Media Center zurückzukehren – diese Fernbedienung funktioniert, solange es im Bild ist.',
  back: 'Zurück',
  home: 'Start',
  options: 'Optionen',
  textBoxOpen: '<b>Am Fernseher ist ein Textfeld geöffnet</b>. Tippe, um es hier einzugeben.',
  textBoxOpenNamed: '<b>Am Fernseher ist ein Textfeld geöffnet</b><i> („{{label}}“)</i>. Tippe, um es hier einzugeben.',
  rewind: 'Zurückspulen',
  playPause: 'Wiedergabe/Pause',
  forward: 'Vorspulen',
  keyboard: 'Tastatur',
  voice: 'Sprache',
  listening: 'Ich höre zu … tippen zum Stoppen',
  voiceOff: 'Sprache (auf diesem Handy nicht verfügbar)',
  voiceUnavailable: 'Sprache ist in diesem Browser nicht verfügbar.',
  didntCatch: 'Das habe ich nicht verstanden. Tippe auf das Mikrofon und versuche es erneut.',
  micBlocked: 'Das Mikrofon ist blockiert. Erlaube es für diese Seite in den Browser-Einstellungen und versuche es dann erneut.',
  noMic: 'Auf diesem Handy wurde kein Mikrofon gefunden.',
  voiceNetwork: 'Sprache braucht eine Internetverbindung. Versuche es erneut.',
  voiceStopped: 'Die Spracheingabe wurde beendet. Tippe auf das Mikrofon, um es erneut zu versuchen.',
  micStartFailed: 'Das Mikrofon konnte nicht gestartet werden. Versuche es erneut.',
  tvBox: 'Textfeld am Fernseher',
  tvBoxNamed: 'Textfeld am Fernseher: „{{label}}“',
  tvBoxPassword: 'Textfeld am Fernseher (ein Passwort: Was du tippst, geht an den Fernseher)',
  tvBoxNamedPassword: 'Textfeld am Fernseher: „{{label}}“ (ein Passwort: Was du tippst, geht an den Fernseher)',
  pickBox: 'Wähle am Fernseher ein Textfeld (Suche oder Anmeldung) und tippe dann hier.',
  typeHere: 'Hier tippen',
  go: 'Los',
};

const AR: Record<Key, string> = {
  title: 'جهاز التحكم Snow Media',
  tooManyTries: 'محاولات كثيرة جدًا من هذه الشبكة. انتظر عشر دقائق ثم حاول مرة أخرى.',
  busy: 'هناك عدد كبير من الهواتف يجري ربطها الآن. حاول مرة أخرى بعد دقيقة.',
  wrongCode: 'لم يعمل هذا الرمز. تحقق من الرمز على التلفزيون، فكل رمز يعمل مرة واحدة فقط.',
  badCode: 'الرمز مكوّن من 8 أحرف، مثل BCDF-GHJK.',
  connectFailed: 'تعذّر الاتصال. تحقق من الإنترنت ثم حاول مرة أخرى.',
  switchTitle: 'الربط بتلفزيون آخر؟',
  switchText: 'هذا الهاتف هو جهاز التحكم لـ «{{label}}» بالفعل. سيؤدي ربطه بالتلفزيون الذي يعرض الرمز {{code}} إلى استبداله.',
  switchPair: 'الربط بالتلفزيون الجديد',
  switchKeep: 'متابعة استخدام «{{label}}»',
  pairHelp: 'على التلفزيون، افتح Snow Media Center ← الإعدادات ← التحكم عبر الهاتف، ثم امسح رمز QR أو اكتب الرمز المكوّن من 8 أحرف هنا.',
  codeAria: 'الرمز الظاهر على التلفزيون',
  connect: 'اتصال',
  backTo: 'العودة إلى «{{label}}»',
  denied: 'لم يسمح التلفزيون بهذا الهاتف.',
  expired: 'لم يستجب التلفزيون في الوقت المناسب. أدخل الرمز الجديد من التلفزيون للمحاولة مرة أخرى.',
  almostTitle: 'أوشكنا على الانتهاء',
  almostText: '«{{label}}» يسأل إن كان سيسمح بهذا الهاتف. اختر <b>سماح</b> بجهاز تحكم التلفزيون (اضغط OK).',
  cancel: 'إلغاء',
  up: 'أعلى',
  down: 'أسفل',
  left: 'يسار',
  right: 'يمين',
  unpairedByTv: 'ألغى هذا التلفزيون ربط هواتفه. اربط من جديد بالرمز الجديد على التلفزيون.',
  forget: 'نسيان',
  quiet: 'التلفزيون لا يستجيب. تأكد من أن Snow Media Center مفتوح عليه، فجهاز التحكم يعمل ما دام التطبيق على الشاشة.',
  away: 'هناك تطبيق آخر على شاشة التلفزيون. استخدم جهاز تحكم التلفزيون للعودة إلى Snow Media Center، فهذا الجهاز يعمل ما دام التطبيق على الشاشة.',
  back: 'رجوع',
  home: 'الرئيسية',
  options: 'خيارات',
  textBoxOpen: '<b>يوجد مربع نص مفتوح على التلفزيون</b>. المس للكتابة هنا.',
  textBoxOpenNamed: '<b>يوجد مربع نص مفتوح على التلفزيون</b><i> («{{label}}»)</i>. المس للكتابة هنا.',
  rewind: 'إرجاع',
  playPause: 'تشغيل/إيقاف مؤقت',
  forward: 'تقديم',
  keyboard: 'لوحة المفاتيح',
  voice: 'الصوت',
  listening: 'جارٍ الاستماع… المس للإيقاف',
  voiceOff: 'الصوت (غير متاح على هذا الهاتف)',
  voiceUnavailable: 'الصوت غير متاح في هذا المتصفح.',
  didntCatch: 'لم أفهم ذلك. المس الميكروفون وحاول مرة أخرى.',
  micBlocked: 'الميكروفون محظور. اسمح به لهذا الموقع من إعدادات المتصفح ثم حاول مرة أخرى.',
  noMic: 'لم يتم العثور على ميكروفون في هذا الهاتف.',
  voiceNetwork: 'يحتاج الصوت إلى اتصال بالإنترنت. حاول مرة أخرى.',
  voiceStopped: 'توقف الصوت. المس الميكروفون للمحاولة مرة أخرى.',
  micStartFailed: 'تعذّر تشغيل الميكروفون. حاول مرة أخرى.',
  tvBox: 'مربع النص على التلفزيون',
  tvBoxNamed: 'مربع النص على التلفزيون: «{{label}}»',
  tvBoxPassword: 'مربع النص على التلفزيون (كلمة مرور: ما تكتبه يذهب إلى التلفزيون)',
  tvBoxNamedPassword: 'مربع النص على التلفزيون: «{{label}}» (كلمة مرور: ما تكتبه يذهب إلى التلفزيون)',
  pickBox: 'اختر مربع نص على التلفزيون (بحث أو تسجيل دخول) ثم اكتب هنا.',
  typeHere: 'اكتب هنا',
  go: 'إرسال',
};

const DICT: Record<Lang, Record<Key, string>> = { en: EN, es: ES, fr: FR, de: DE, ar: AR };

const asLang = (raw: unknown): Lang | null => {
  const l = String(raw ?? '').slice(0, 2).toLowerCase();
  return (LANGS as string[]).includes(l) ? (l as Lang) : null;
};
/** ?lang= from the QR (kept for next time, since the address is cleaned), else the last one, else English. */
const pageLang = (): Lang => {
  try {
    const fromUrl = asLang(new URLSearchParams(window.location.search).get('lang'));
    if (fromUrl) { try { localStorage.setItem(LANG_KEY, fromUrl); } catch { /* private mode */ } return fromUrl; }
  } catch { /* no address */ }
  try { return asLang(localStorage.getItem(LANG_KEY)) ?? 'en'; } catch { return 'en'; }
};

/** The page's text in the TV's language; `{{name}}` values are filled from `params`. */
const tr = (key: Key, params?: Record<string, string>): string => {
  const text = DICT[pageLang()][key] ?? EN[key];
  return params ? text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => params[name] ?? '') : text;
};

/** `<b>bold</b>` and `<i>softer</i>` inside a text. */
const rich = (text: string): ReactNode[] =>
  text.split(/(<b>.*?<\/b>|<i>.*?<\/i>)/).filter(Boolean).map((part, i) => {
    if (part.startsWith('<b>')) return <span key={i} className="font-semibold text-white">{part.slice(3, -4)}</span>;
    if (part.startsWith('<i>')) return <span key={i} className="text-white/70">{part.slice(3, -4)}</span>;
    return part;
  });

// ── pairing ────────────────────────────────────────────────────────────────

function PairScreen({ onPaired, message, saved, onKeepSaved }: {
  onPaired: (p: Pairing) => void;
  message?: string | null;
  /** A TV this phone is already the remote for. */
  saved: Pairing | null;
  onKeepSaved: () => void;
}) {
  const [code, setCode] = useState(codeFromUrl);
  // Opened from a QR while already paired: switching TVs takes a tap, so a
  // link someone sends can't quietly take this phone's remote elsewhere.
  const [askSwitch, setAskSwitch] = useState(() => !!saved && codeFromUrl().length === 8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(message ?? null);
  const [waiting, setWaiting] = useState<{ token: string; label: string } | null>(null);
  const tried = useRef(false);

  const join = useCallback(async (c: string) => {
    if (c.length !== 8 || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await call({ op: 'join', code: c });
      if (!r.ok || typeof r.token !== 'string') {
        setError(r.reason === 'too_many' ? tr('tooManyTries')
          : r.reason === 'busy' ? tr('busy')
            : r.reason === 'wrong_code' ? tr('wrongCode')
              : r.reason === 'bad_code' ? tr('badCode')
                : tr('connectFailed'));
        return;
      }
      clearUrl();
      setWaiting({ token: r.token, label: typeof r.label === 'string' && r.label ? r.label : 'Snow Media Center' });
    } catch {
      setError(tr('connectFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Opened from the TV's QR: connect straight away.
  useEffect(() => {
    if (!askSwitch && !tried.current && code.length === 8) { tried.current = true; void join(code); }
  }, [askSwitch, code, join]);

  if (waiting) {
    return (
      <WaitScreen
        token={waiting.token}
        label={waiting.label}
        onPaired={onPaired}
        onStop={(msg) => { setWaiting(null); setCode(''); setError(msg); }}
      />
    );
  }

  if (askSwitch && saved) {
    return (
      <div className="min-h-screen bg-[#071b3a] text-white flex flex-col items-center justify-center px-6">
        <Tv className="w-14 h-14 text-[#d4af6a] mb-4" />
        <h1 dir="auto" className="text-2xl font-bold text-center mb-2">{tr('switchTitle')}</h1>
        <p dir="auto" className="text-white/70 text-center mb-8 max-w-sm">
          {tr('switchText', { label: saved.label, code: showCode(code) })}
        </p>
        <button type="button" onClick={() => setAskSwitch(false)} className="w-72 rounded-2xl bg-[#d4af6a] text-black font-bold text-lg py-4">
          {tr('switchPair')}
        </button>
        <button type="button" onClick={() => { clearUrl(); onKeepSaved(); }} className="mt-3 w-72 rounded-2xl bg-white/10 font-semibold py-4">
          {tr('switchKeep', { label: saved.label })}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#071b3a] text-white flex flex-col items-center justify-center px-6">
      <Tv className="w-14 h-14 text-[#d4af6a] mb-4" />
      <h1 dir="auto" className="text-3xl font-bold text-center mb-2">{tr('title')}</h1>
      <p dir="auto" className="text-white/70 text-center mb-8 max-w-sm">
        {tr('pairHelp')}
      </p>
      <input
        value={showCode(code)}
        onChange={(e) => setCode(cleanCode(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') void join(code); }}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        aria-label={tr('codeAria')}
        placeholder={SAMPLE_CODE}
        className="w-72 text-center text-3xl tracking-[0.15em] font-bold rounded-2xl bg-white/10 border border-white/20 py-4 outline-none focus:border-[#d4af6a] uppercase"
      />
      <button
        type="button"
        onClick={() => void join(code)}
        disabled={code.length !== 8 || busy}
        className="mt-6 w-72 rounded-2xl bg-[#d4af6a] text-black font-bold text-lg py-4 disabled:opacity-40 flex items-center justify-center"
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Smartphone className="w-5 h-5 mr-2" />}
        {tr('connect')}
      </button>
      {saved && (
        <button type="button" onClick={onKeepSaved} className="mt-4 text-white/60 text-sm underline">
          {tr('backTo', { label: saved.label })}
        </button>
      )}
      {error && <p dir="auto" className="mt-4 text-amber-300 text-center max-w-sm">{error}</p>}
    </div>
  );
}

/** The code was right; the TV now asks "Allow this phone?". */
function WaitScreen({ token, label, onPaired, onStop }: {
  token: string; label: string;
  onPaired: (p: Pairing) => void;
  onStop: (message: string | null) => void;
}) {
  const onPairedRef = useRef(onPaired); onPairedRef.current = onPaired;
  const onStopRef = useRef(onStop); onStopRef.current = onStop;
  const labelRef = useRef(label); labelRef.current = label;
  useEffect(() => {
    const onPaired = (p: Pairing) => onPairedRef.current(p);
    const onStop = (msg: string | null) => onStopRef.current(msg);
    let alive = true;
    let timer = 0;
    const started = Date.now();
    const poll = async () => {
      if (!alive) return;
      try {
        const r = await call({ op: 'claim', token });
        if (!alive) return;
        if (r.ok && typeof r.secret === 'string' && /^[0-9a-f]{64}$/.test(r.secret)) {
          const p: Pairing = { secret: r.secret, label: typeof r.label === 'string' && r.label ? r.label : labelRef.current, id: newId() };
          savePairing(p);
          buzz();
          onPaired(p);
          return;
        }
        if (!r.ok && r.reason === 'denied') { onStop(tr('denied')); return; }
        if (!r.ok && r.reason === 'expired') { onStop(tr('expired')); return; }
      } catch { /* a network blip: keep asking */ }
      if (Date.now() - started > CLAIM_GIVE_UP_MS) { onStop(tr('expired')); return; }
      timer = window.setTimeout(() => void poll(), CLAIM_EVERY_MS);
    };
    void poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [token]);

  return (
    <div className="min-h-screen bg-[#071b3a] text-white flex flex-col items-center justify-center px-6">
      <Tv className="w-14 h-14 text-[#d4af6a] mb-4" />
      <h1 dir="auto" className="text-2xl font-bold text-center mb-2">{tr('almostTitle')}</h1>
      <p dir="auto" className="text-white/80 text-center mb-2 max-w-sm">
        {rich(tr('almostText', { label }))}
      </p>
      <Loader2 className="w-8 h-8 animate-spin text-white/70 my-6" />
      <button type="button" onClick={() => onStop(null)} className="text-white/60 text-sm underline">{tr('cancel')}</button>
    </div>
  );
}

// ── the remote ─────────────────────────────────────────────────────────────

function Pad({ onKey }: { onKey: (k: string) => void }) {
  const timer = useRef<number | null>(null);
  const stop = () => { if (timer.current) { window.clearTimeout(timer.current); window.clearInterval(timer.current); timer.current = null; } };
  const press = (k: string) => (e: ReactPointerEvent) => {
    e.preventDefault();
    stop();
    onKey(k);
    // Arrows repeat while held, like a real remote.
    if (k !== 'ok') {
      timer.current = window.setTimeout(() => { timer.current = window.setInterval(() => onKey(k), REPEAT_EVERY_MS); }, REPEAT_DELAY_MS);
    }
  };
  useEffect(() => stop, []);
  const btn = 'absolute flex items-center justify-center text-white active:bg-white/20 rounded-full select-none touch-none';
  return (
    <div className="relative w-72 h-72 rounded-full bg-white/10 border border-white/15 mx-auto" onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
      <button type="button" aria-label={tr('up')} className={`${btn} left-1/2 -translate-x-1/2 top-2 w-24 h-20`} onPointerDown={press('up')}><ChevronUp className="w-10 h-10" /></button>
      <button type="button" aria-label={tr('down')} className={`${btn} left-1/2 -translate-x-1/2 bottom-2 w-24 h-20`} onPointerDown={press('down')}><ChevronDown className="w-10 h-10" /></button>
      <button type="button" aria-label={tr('left')} className={`${btn} top-1/2 -translate-y-1/2 left-2 w-20 h-24`} onPointerDown={press('left')}><ChevronLeft className="w-10 h-10" /></button>
      <button type="button" aria-label={tr('right')} className={`${btn} top-1/2 -translate-y-1/2 right-2 w-20 h-24`} onPointerDown={press('right')}><ChevronRight className="w-10 h-10" /></button>
      <button type="button" aria-label={OK_KEY} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-[#d4af6a] text-black text-2xl font-bold active:scale-95 select-none touch-none" onPointerDown={press('ok')}>{OK_KEY}</button>
    </div>
  );
}

type Field = { typing: boolean; value: string; password: boolean; label: string };
const NO_FIELD: Field = { typing: false, value: '', password: false, label: '' };

function RemoteScreen({ pairing, onUnpaired }: { pairing: Pairing; onUnpaired: (msg?: string) => void }) {
  /** connecting: channel not up yet · live: the TV answers · quiet: it doesn't · away: SMC isn't on the TV screen */
  const [status, setStatus] = useState<'connecting' | 'live' | 'quiet' | 'away'>('connecting');
  const [field, setField] = useState<Field>(NO_FIELD);
  const fieldRef = useRef<Field>(NO_FIELD);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<Array<{ payload: Record<string, unknown>; at: number }>>([]);
  const heardAtRef = useRef(0);
  const connectRef = useRef<() => void>(() => {});
  const textTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: (send: boolean) => void } | null>(null);
  const Speech = useMemo(speechCtor, []);
  const onUnpairedRef = useRef(onUnpaired); onUnpairedRef.current = onUnpaired;

  const send = useCallback((payload: Record<string, unknown>) => {
    const msg = { ...payload, id: pairing.id };
    const ch = channelRef.current;
    if (ch && readyRef.current) { void ch.send({ type: 'broadcast', event: 'phone', payload: msg }); return; }
    // Not connected (yet, or again): hold it until the channel is up, and
    // don't let a reconnect sit out its back-off while someone is pressing.
    queueRef.current.push({ payload: msg, at: Date.now() });
    if (queueRef.current.length > 30) queueRef.current.shift();
    connectRef.current();
  }, [pairing.id]);

  useEffect(() => {
    let alive = true;
    let retry = 0;
    let retryTimer = 0;
    let replyTimer = 0;
    let lastCheck = 0;
    let attemptAt = 0;
    const secret = pairing.secret;

    // Is this pairing still there? (The TV may have unpaired while this page
    // was closed, and then nothing on the channel will ever answer.)
    const check = async (force = false) => {
      if (!force && Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      try {
        const r = await call({ op: 'check', secret });
        if (alive && r.ok && r.exists === false) {
          savePairing(null);
          onUnpairedRef.current(tr('unpairedByTv'));
        }
      } catch { /* offline: try again later */ }
    };

    const hello = () => {
      const ch = channelRef.current;
      if (!ch || !readyRef.current) return;
      const sentAt = Date.now();
      void ch.send({ type: 'broadcast', event: 'phone', payload: { t: 'hello', id: pairing.id } });
      window.clearTimeout(replyTimer);
      replyTimer = window.setTimeout(() => {
        if (!alive || heardAtRef.current >= sentAt) return;
        setStatus('quiet');
        void check();
      }, REPLY_WITHIN_MS);
    };

    const onBox = (m: { t?: string; typing?: boolean; value?: string; password?: boolean; label?: string; why?: string }) => {
      heardAtRef.current = Date.now();
      if (m.t === 'away') { setStatus('away'); return; }
      setStatus('live');
      if (m.t === 'field') {
        const prev = fieldRef.current;
        const f: Field = { typing: !!m.typing, value: String(m.value ?? '').slice(0, 500), password: !!m.password, label: String(m.label ?? '').slice(0, 80) };
        const changed = prev.typing !== f.typing || prev.label !== f.label || prev.password !== f.password;
        fieldRef.current = f;
        setField(f);
        // A reply to our hello about the same text box: what the phone has
        // typed stays (the TV's copy may be a keystroke behind).
        if (m.why === 'hello' && !changed) return;
        if (f.typing) setText(f.value);
      }
      if (m.t === 'unpaired') {
        // Only the pairing's own record decides (anyone on the channel could
        // say this); give the TV a moment to finish unpairing first.
        window.setTimeout(() => void check(true), 1500);
        window.setTimeout(() => void check(true), 6000);
      }
    };

    const flush = () => {
      const ch = channelRef.current;
      if (!ch) return;
      const now = Date.now();
      const q = queueRef.current.filter((m) => now - m.at < QUEUE_KEEP_MS);
      queueRef.current = [];
      for (const m of q) void ch.send({ type: 'broadcast', event: 'phone', payload: m.payload });
    };

    const close = (rt: RealtimeClient | null) => { if (rt) { try { void rt.removeAllChannels(); rt.disconnect(); } catch { /* already gone */ } } };
    const drop = () => {
      const rt = realtimeRef.current;
      realtimeRef.current = null;
      channelRef.current = null;
      readyRef.current = false;
      close(rt);
    };

    const connect = () => {
      if (!alive) return;
      attemptAt = Date.now();
      window.clearTimeout(retryTimer);
      drop();
      const rt = newRealtime();
      realtimeRef.current = rt;
      const ch = rt.channel(`smc-remote:${secret}`, { config: { broadcast: { self: false } } });
      channelRef.current = ch;
      ch.on('broadcast', { event: 'box' }, ({ payload }) => { if (alive && channelRef.current === ch) onBox(payload as Parameters<typeof onBox>[0]); });
      ch.subscribe((s) => {
        if (!alive || channelRef.current !== ch) return;
        if (s === 'SUBSCRIBED') {
          // (Also after the library rejoined by itself: no need to start over.)
          window.clearTimeout(retryTimer);
          readyRef.current = true;
          retry = 0;
          hello();
          flush();
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          // Dropped (a phone asleep, a network change): start over, sooner
          // at first, then every ten seconds.
          readyRef.current = false;
          setStatus((st) => (st === 'live' ? 'connecting' : st));
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
        }
      });
    };
    // A press while down: try now, unless a try has just started.
    connectRef.current = () => { if (!readyRef.current && Date.now() - attemptAt > 3000) { retry = 0; connect(); } };
    connect();
    void check(true);

    const helloTimer = window.setInterval(hello, HELLO_EVERY_MS);
    // Back from the lock screen or another app: the socket may be dead
    // without knowing it yet, so start fresh unless the TV answers at once.
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      if (!readyRef.current) { retry = 0; connect(); return; }
      const before = heardAtRef.current;
      hello();
      window.setTimeout(() => { if (alive && heardAtRef.current === before) { retry = 0; connect(); } }, 4000);
    };
    const bye = () => {
      const ch = channelRef.current;
      if (ch && readyRef.current) void ch.send({ type: 'broadcast', event: 'phone', payload: { t: 'bye', id: pairing.id } });
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('online', onShow);
    window.addEventListener('pagehide', bye);
    return () => {
      alive = false;
      window.clearInterval(helloTimer);
      window.clearTimeout(retryTimer);
      window.clearTimeout(replyTimer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('online', onShow);
      window.removeEventListener('pagehide', bye);
      bye();
      queueRef.current = [];
      connectRef.current = () => {};
      const rt = realtimeRef.current;
      realtimeRef.current = null;
      channelRef.current = null;
      readyRef.current = false;
      // After the bye has gone out.
      window.setTimeout(() => close(rt), 300);
    };
  }, [pairing.secret, pairing.id]);

  const key = useCallback((k: string) => { buzz(); send({ t: 'key', k }); }, [send]);

  const onType = (v: string) => {
    setText(v);
    if (textTimer.current) window.clearTimeout(textTimer.current);
    textTimer.current = window.setTimeout(() => send({ t: 'text', v }), 120);
  };

  const openKeyboard = () => {
    setKeyboardOpen(true);
    // Focus inside the tap itself, so the phone's keyboard comes up (iOS
    // only opens it from a tap), and once more after the panel renders.
    try { inputRef.current?.focus(); } catch { /* not there yet */ }
    window.setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Voice. A tap listens; a tap while listening stops (and sends what was
  // heard). Whatever the browser does, it never stays on "Listening…": a
  // pause after words, an error, or ten seconds end it.
  const talk = () => {
    if (!Speech) return;
    if (recRef.current) { recRef.current.stop(true); return; }
    let r: Speech;
    try { r = new Speech(); } catch { setVoiceNote(tr('voiceUnavailable')); return; }
    let heard = '';
    let done = false;
    let pauseTimer = 0;
    let maxTimer = 0;
    const handle = { stop: (sendIt: boolean) => finish(sendIt, null) };
    /** `note`: what to say when nothing is sent (undefined: "didn't catch that"). */
    const finish = (sendIt: boolean, note?: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(pauseTimer);
      window.clearTimeout(maxTimer);
      if (recRef.current === handle) recRef.current = null;
      r.onresult = null; r.onend = null; r.onerror = null;
      try { if (r.abort) r.abort(); else r.stop(); } catch { /* already stopped */ }
      setListening(false);
      const said = heard.trim();
      if (sendIt && said) {
        setVoiceNote(null);
        // With a text box open on the TV, words go into it; otherwise they are a command.
        if (fieldRef.current.typing) { setKeyboardOpen(true); onType(said); } else send({ t: 'voice', v: said });
      } else {
        setVoiceNote(note === undefined ? tr('didntCatch') : note);
      }
    };
    maxTimer = window.setTimeout(() => finish(true), VOICE_MAX_MS);
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let said = '';
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        said += e.results[i]?.[0]?.transcript ?? '';
        if (e.results[i]?.isFinal) final = true;
      }
      heard = said;
      window.clearTimeout(pauseTimer);
      if (final) { finish(true); return; }
      pauseTimer = window.setTimeout(() => finish(true), VOICE_PAUSE_MS);
    };
    r.onerror = (e) => {
      const why = e?.error;
      if (why === 'not-allowed' || why === 'service-not-allowed') finish(false, tr('micBlocked'));
      else if (why === 'audio-capture') finish(false, tr('noMic'));
      else if (why === 'network') finish(true, tr('voiceNetwork'));
      else if (why === 'aborted') finish(true, null);
      else if (why === 'no-speech') finish(true);
      else finish(true, tr('voiceStopped'));
    };
    r.onend = () => finish(true);
    recRef.current = handle;
    setListening(true);
    setVoiceNote(null);
    buzz();
    try { r.start(); } catch { finish(false, tr('micStartFailed')); }
  };
  // Leaving the page (or this TV) stops the mic.
  useEffect(() => () => { recRef.current?.stop(false); }, []);

  const small = 'flex flex-col items-center justify-center rounded-2xl bg-white/10 active:bg-white/20 py-3 text-xs text-white/80 select-none';
  const typingOnTv = field.typing && !keyboardOpen;
  const isQuiet = status === 'quiet';
  const isAway = status === 'away';
  return (
    <div className="min-h-screen bg-[#071b3a] text-white px-5 pt-5 pb-8 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full mr-2 ${status === 'live' ? 'bg-emerald-400' : status === 'quiet' || status === 'away' ? 'bg-amber-400' : 'bg-white/40 animate-pulse'}`} />
          <span className="truncate font-semibold">{pairing.label}</span>
        </div>
        <button type="button" onClick={() => { savePairing(null); onUnpaired(); }} className="text-white/60 text-sm flex items-center"><Unlink className="w-4 h-4 mr-1" /> {tr('forget')}</button>
      </div>
      {isQuiet && (
        <p dir="auto" className="mb-4 rounded-xl bg-amber-500/15 border border-amber-400/40 px-3 py-2 text-sm text-amber-200">
          {tr('quiet')}
        </p>
      )}
      {isAway && (
        <p dir="auto" className="mb-4 rounded-xl bg-amber-500/15 border border-amber-400/40 px-3 py-2 text-sm text-amber-200">
          {tr('away')}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        <button type="button" className={small} onClick={() => key('back')}><ArrowLeft className="w-6 h-6 mb-1" />{tr('back')}</button>
        <button type="button" className={small} onClick={() => { buzz(); send({ t: 'home' }); }}><Home className="w-6 h-6 mb-1" />{tr('home')}</button>
        <button type="button" className={small} onClick={() => key('menu')}><Menu className="w-6 h-6 mb-1" />{tr('options')}</button>
      </div>

      {typingOnTv && (
        <button type="button" onClick={openKeyboard} className="mb-4 rounded-xl bg-[#d4af6a]/20 border border-[#d4af6a]/60 px-3 py-2 text-sm text-left">
          {rich(field.label ? tr('textBoxOpenNamed', { label: field.label }) : tr('textBoxOpen'))}
        </button>
      )}

      <Pad onKey={key} />

      <div className="grid grid-cols-3 gap-3 mt-6">
        <button type="button" className={small} onClick={() => key('rw')}><Rewind className="w-6 h-6 mb-1" />{tr('rewind')}</button>
        <button type="button" className={small} onClick={() => key('playpause')}><Pause className="w-6 h-6 mb-1" />{tr('playPause')}</button>
        <button type="button" className={small} onClick={() => key('ff')}><FastForward className="w-6 h-6 mb-1" />{tr('forward')}</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <button type="button" className={`${small} ${typingOnTv ? 'ring-2 ring-[#d4af6a]' : ''}`} onClick={() => { if (keyboardOpen) setKeyboardOpen(false); else openKeyboard(); }}>
          <Keyboard className="w-6 h-6 mb-1" />{tr('keyboard')}
        </button>
        <button type="button" className={`${small} ${listening ? 'bg-red-500/40' : ''}`} onClick={talk} disabled={!Speech}>
          <Mic className="w-6 h-6 mb-1" />{Speech ? (listening ? tr('listening') : tr('voice')) : tr('voiceOff')}
        </button>
      </div>
      {voiceNote && <p dir="auto" className="mt-2 text-center text-sm text-amber-200">{voiceNote}</p>}

      {keyboardOpen && (
        <div className="mt-4 rounded-2xl bg-white/10 p-3">
          <div dir="auto" className="text-xs text-white/60 mb-2">
            {field.typing
              ? (field.label
                ? tr(field.password ? 'tvBoxNamedPassword' : 'tvBoxNamed', { label: field.label })
                : tr(field.password ? 'tvBoxPassword' : 'tvBox'))
              : tr('pickBox')}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (textTimer.current) window.clearTimeout(textTimer.current); send({ t: 'text', v: text }); window.setTimeout(() => send({ t: 'submit' }), 150); buzz(); }} className="flex">
            <input
              ref={inputRef}
              type={field.password ? 'password' : 'text'}
              value={text}
              onChange={(e) => onType(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="go"
              className="flex-1 rounded-xl bg-black/30 border border-white/20 px-3 py-3 text-lg outline-none focus:border-[#d4af6a]"
              placeholder={tr('typeHere')}
            />
            <button type="submit" className="ml-2 rounded-xl bg-[#d4af6a] text-black font-bold px-4">{tr('go')}</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function PhoneRemotePage() {
  const [pairing, setPairing] = useState<Pairing | null>(() => {
    // A code in the address means a (maybe different) TV: the pairing screen
    // decides (it asks first when this phone already has a TV).
    if (codeFromUrl().length === 8) return null;
    return loadPairing();
  });
  const [message, setMessage] = useState<string | null>(null);
  const onUnpaired = useCallback((msg?: string) => { setPairing(null); setMessage(msg ?? null); }, []);
  const onPaired = useCallback((p: Pairing) => { setMessage(null); setPairing(p); }, []);
  const onKeepSaved = useCallback(() => { setMessage(null); setPairing(loadPairing()); }, []);
  useEffect(() => {
    document.title = tr('title');
    // The text is in the TV's language: say so, and give the site's own back on the way out.
    const before = document.documentElement.lang;
    try { document.documentElement.lang = pageLang(); } catch { /* no document */ }
    return () => { try { document.documentElement.lang = before; } catch { /* no document */ } };
  }, []);
  return pairing
    ? <RemoteScreen key={pairing.secret} pairing={pairing} onUnpaired={onUnpaired} />
    : <PairScreen onPaired={onPaired} message={message} saved={loadPairing()} onKeepSaved={onKeepSaved} />;
}
