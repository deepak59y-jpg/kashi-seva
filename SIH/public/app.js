// app.js (Updated: diagnostic + safe-write included)
// ----------------- CONFIG: your firebaseConfig (keeps yours) -----------------
const firebaseConfig = {
  apiKey: "AIzaSyCCCNLDhSSXzomzOGbiCNpCnkjvLjAWxz0",
  authDomain: "kashi-seva.firebaseapp.com",
  projectId: "kashi-seva",
  storageBucket: "kashi-seva.firebasestorage.app",
  messagingSenderId: "116745302054",
  appId: "1:116745302054:web:6aefd31122d3bb49a276e7",
  measurementId: "G-WZB3H9C20K"
};
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

/* ---- UI elements (guarded) ---- */
const phoneEl = document.getElementById('phone');
const sendBtn = document.querySelector('button[onclick="sendOTP()"]');
const otpSection = document.getElementById('otp-section');
const otpEl = document.getElementById('otp');
const queueSection = document.getElementById('queue-section');
const queueSelect = document.getElementById('queueType');
const priorityOptions = document.getElementById('priority-options');
const familyMembersEl = document.getElementById('familyMembers');
const statusEl = document.getElementById('status');
const resultSection = document.getElementById('result-section');
const blockAllocatedEl = document.getElementById('blockAllocated');
const qrContainer = document.getElementById('qrContainer');

function elOrNull(id) { return document.getElementById(id) || null; }

/* ---- State ---- */
let confirmationResult = null;
let signedPhone = null;
let currentUser = null;

/* ---- recaptcha setup (invisible) ---- */
function createRecaptcha() {
  try {
    if (window.recaptchaVerifier && typeof window.recaptchaVerifier.clear === 'function') {
      window.recaptchaVerifier.clear();
    }
  } catch (e) {
    console.warn('recaptcha clear error', e);
  }

  const rcContainer = elOrNull('recaptcha-container');
  if (!rcContainer) {
    console.warn('No #recaptcha-container found in DOM — phone auth may fail on web.');
  }

  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
    size: 'invisible',
    callback: (response) => {
      console.debug('reCAPTCHA solved');
    },
    'expired-callback': () => {
      console.debug('reCAPTCHA expired');
    }
  });
}
createRecaptcha();

/* ---- send OTP ---- */
async function sendOTP() {
  const phone = phoneEl ? phoneEl.value.trim() : '';
  statusEl && (statusEl.textContent = '');
  if (resultSection) resultSection.style.display = 'none';

  if (!phone) {
    if (statusEl) statusEl.textContent = 'Enter phone number';
    return;
  }

  try {
    if (!window.recaptchaVerifier) createRecaptcha();
    statusEl && (statusEl.textContent = 'Sending OTP...');
    confirmationResult = await auth.signInWithPhoneNumber(String(phone), window.recaptchaVerifier);
    signedPhone = String(phone);
    if (statusEl) statusEl.textContent = 'OTP sent. Enter the code.';
    if (otpSection) otpSection.style.display = '';
    console.debug('confirmationResult ready', confirmationResult);
  } catch (err) {
    console.error('sendOTP error', err);
    if (statusEl) statusEl.textContent = 'Error sending OTP: ' + (err && err.message ? err.message : err);
    try { createRecaptcha(); } catch (_) {}
  }
}

/* ---- verify OTP ---- */
async function verifyOTP() {
  const code = otpEl ? String(otpEl.value || '').trim() : '';
  if (!confirmationResult) {
    if (statusEl) statusEl.textContent = 'No OTP request found. Click Send OTP first.';
    return;
  }
  if (!code) {
    if (statusEl) statusEl.textContent = 'Enter the OTP code.';
    return;
  }

  try {
    if (statusEl) statusEl.textContent = 'Verifying...';
    const result = await confirmationResult.confirm(code);
    currentUser = result.user || null;
    if (statusEl) statusEl.textContent = 'Phone verified.';
    if (otpSection) otpSection.style.display = 'none';
    if (queueSection) queueSection.style.display = '';
    console.debug('verify result user:', currentUser && currentUser.phoneNumber);
  } catch (err) {
    console.error('verifyOTP error', err);
    if (statusEl) statusEl.textContent = 'OTP verification failed: ' + (err && err.message ? err.message : err);
  }
}

/* ---- UI: toggle priority options ---- */
function togglePriorityOptions() {
  const val = queueSelect ? queueSelect.value : '';
  if (priorityOptions) priorityOptions.style.display = (val === 'priority') ? '' : 'none';
}
window.togglePriorityOptions = togglePriorityOptions;

/* ---- helpers ---- */
function safeString(v) {
  try {
    if (v === null || v === undefined) return '';
    return String(v);
  } catch (e) {
    return '';
  }
}
function safeInt(v, fallback = 1) {
  const n = parseInt(String(v || ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/* ---- register user (with diagnostics + safe-write) ---- */
async function registerUser() {
  if (!statusEl) console.warn('No #status element found.');

  try {
    if (statusEl) statusEl.textContent = '';
    if (!currentUser && !signedPhone) {
      if (statusEl) statusEl.textContent = 'Please verify phone first.';
      return;
    }

    // sanitize inputs (only primitives)
    const phone = currentUser && currentUser.phoneNumber ? safeString(currentUser.phoneNumber) : safeString(signedPhone);
    const queueType = safeString(queueSelect ? queueSelect.value : 'normal') || 'normal';
    const priorityReasonEl = elOrNull('priorityReason');
    const priorityReason = priorityReasonEl ? safeString(priorityReasonEl.value || '') : null;
    const familyMembers = safeInt(familyMembersEl ? familyMembersEl.value : 1, 1);

    if (statusEl) statusEl.textContent = 'Registering...';

    // Transactional allocation
    const blocksRef = db.collection('blocks');

    const allocation = await db.runTransaction(async (tx) => {
      const snap = await tx.get(blocksRef.orderBy('name').limit(50));
      if (snap.empty) {
        const newBlockRef = blocksRef.doc();
        tx.set(newBlockRef, { name: 'Block 1', capacity: 200, count: 0, queueType: 'normal' });
        return { id: newBlockRef.id, name: 'Block 1', created: true };
      }

      let chosen = null;
      snap.forEach(doc => {
        const d = doc.data();
        const ccount = Number(d.count || 0);
        const cap = Number(d.capacity || 0);
        if (ccount < cap) {
          if (!chosen || ccount < (chosen.data.count || 0)) chosen = { doc, data: d };
        }
      });

      if (!chosen) {
        const newRef = blocksRef.doc();
        const newName = `Block ${Date.now()}`;
        tx.set(newRef, { name: newName, capacity: 200, count: 0, queueType: 'normal' });
        return { id: newRef.id, name: newName, created: true };
      }

      const chosenRef = chosen.doc.ref;
      const newCount = (chosen.data.count || 0) + familyMembers;
      if (newCount > (chosen.data.capacity || 0)) {
        throw new Error('block_over_capacity');
      }
      tx.update(chosenRef, { count: newCount });
      return { id: chosenRef.id, name: chosen.data.name };
    }, { maxAttempts: 5 });

    // If created flag returned, update count defensively
    if (allocation && allocation.created) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection('blocks').doc(allocation.id);
        const doc = await tx.get(ref);
        if (!doc.exists) throw new Error('Block disappeared');
        const newCount = (doc.data().count || 0) + familyMembers;
        if (newCount > (doc.data().capacity || 0)) throw new Error('Block full');
        tx.update(ref, { count: newCount });
      });
    }

    const blockId = safeString(allocation.id);
    const blockName = safeString(allocation.name);

    // ---- Build regData (with serverTimestamp) ----
    const regData = {
      phone: safeString(phone),
      queueType: safeString(queueType),
      priorityReason: priorityReason ? safeString(priorityReason) : null,
      familyMembers: Number(familyMembers),
      blockId: blockId,
      blockName: blockName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      status: 'registered'
    };

    // ---- DIAGNOSTIC: print types/constructors ----
    console.group('regData diagnostic');
    Object.entries(regData).forEach(([k, v]) => {
      try {
        const ctor = v && v.constructor ? v.constructor.name : typeof v;
        console.log(`${k}: typeof=${typeof v}, ctor=${ctor}`, v);
      } catch (e) {
        console.log(`${k}: <error reading constructor>`, e);
      }
    });
    console.log('phone raw:', phone, typeof phone, phone && phone.constructor ? phone.constructor.name : null);
    console.log('queueType raw:', queueType);
    console.log('priorityReason raw:', priorityReason);
    console.log('familyMembers raw:', familyMembers, typeof familyMembers);
    console.log('blockId raw:', blockId);
    console.log('blockName raw:', blockName);
    console.groupEnd();

    // ---- SAFE WRITE: write all fields except createdAt first, then set createdAt ----
    let regRef = db.collection('registrations').doc();
    try {
      // copy without createdAt
      const { createdAt, ...regWithoutTs } = regData;

      // ensure only primitives and nulls remain
      Object.entries(regWithoutTs).forEach(([k, v]) => {
        const t = typeof v;
        if (!['string','number','boolean','object'].includes(t)) {
          console.warn(`Field ${k} has unexpected typeof ${t}. Converting to string.`);
          regWithoutTs[k] = String(v);
        }
        if (t === 'object' && v !== null) {
          try {
            JSON.stringify(v);
          } catch (e) {
            console.warn(`Field ${k} is non-serializable. Converting to string.`, e);
            regWithoutTs[k] = String(v);
          }
        }
      });

      console.debug('Attempting safe set (without createdAt):', regWithoutTs);
      await regRef.set(regWithoutTs);

      // Now set server timestamp separately (allowed FieldValue)
      await regRef.update({ createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      console.info('Registration saved (safe path). id=', regRef.id);
    } catch (writeErr) {
      console.error('Safe write failed:', writeErr);
      // fallback: try to stringify everything to ensure a write
      try {
        const fallback = {
          phone: safeString(phone),
          queueType: safeString(queueType),
          priorityReason: priorityReason ? safeString(priorityReason) : null,
          familyMembers: Number(familyMembers),
          blockId: safeString(blockId),
          blockName: safeString(blockName),
          status: 'registered',
          debugRaw: String({
            maybe: 'fallback',
            ts: new Date().toISOString()
          })
        };
        regRef = db.collection('registrations').doc();
        await regRef.set(fallback);
        await regRef.update({ createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        console.warn('Fallback write succeeded. id=', regRef.id);
      } catch (fallbackErr) {
        console.error('Fallback write also failed:', fallbackErr);
        throw fallbackErr; // move to outer catch to show UI error
      }
    }

    // Build QR payload (only primitives)
    const payload = {
      registrationId: regRef.id,
      phone: regData.phone,
      blockId: regData.blockId,
      blockName: regData.blockName,
      createdAt: new Date().toISOString()
    };

    // Update UI
    if (blockAllocatedEl) blockAllocatedEl.textContent = `Allocated to: ${blockName}`;
    if (resultSection) resultSection.style.display = '';
    if (qrContainer) qrContainer.innerHTML = '';

    const qrText = JSON.stringify(payload);

    if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
      QRCode.toCanvas(qrText, { width: 260 }, function (err, canvas) {
        if (err) {
          console.error('QR generation failed', err);
          const img = document.createElement('img');
          img.src = 'https://chart.googleapis.com/chart?cht=qr&chs=260x260&chl=' + encodeURIComponent(qrText);
          if (qrContainer) qrContainer.appendChild(img);
        } else {
          if (qrContainer) qrContainer.appendChild(canvas);
        }
      });
    } else {
      const img = document.createElement('img');
      img.alt = 'QR code';
      img.width = 260;
      img.height = 260;
      img.src = 'https://chart.googleapis.com/chart?cht=qr&chs=260x260&chl=' + encodeURIComponent(qrText);
      if (qrContainer) qrContainer.appendChild(img);
    }

    if (statusEl) statusEl.textContent = 'Registration successful. Please save the QR.';
    console.info('Registration created:', regRef.id);

  } catch (err) {
    console.error('registerUser error', err);
    if (statusEl) statusEl.textContent = 'Registration failed: ' + (err && err.message ? err.message : err);
  }
}

/* expose to global so inline onclick works */
window.sendOTP = sendOTP;
window.verifyOTP = verifyOTP;
window.registerUser = registerUser;
