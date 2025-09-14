// ---------- admin.js (auth-aware + allocation) ----------
// Put your Firestore config here
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
const firestore = firebase.firestore();

const blocksTable = document.getElementById('blocksTable');
const registrationsTable = document.getElementById('registrationsTable');
const adminMsg = document.getElementById('adminMsg') || null;

function logAdmin(msg){
  console.log('[admin] ', msg);
  if(adminMsg) adminMsg.textContent = msg;
}

// Start only when admin signed in
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    logAdmin('No user signed in. Please sign in as admin.');
    return;
  }
  // refresh token to get latest custom claims
  const idToken = await user.getIdTokenResult(true).catch(e => { console.error(e); return null; });
  const claims = idToken ? idToken.claims : {};
  console.log('claims:', claims);
  if (claims && claims.admin === true) {
    logAdmin('Admin authenticated. Starting listeners...');
    startAdminListeners();
  } else {
    logAdmin('Signed-in user is not admin. Claims: ' + JSON.stringify(claims));
  }
});

// Start listeners
let blocksUnsub = null;
let regsUnsub = null;

function startAdminListeners() {
  // blocks listener
  blocksUnsub = firestore.collection('blocks')
    .onSnapshot(snap => {
      blocksTable.innerHTML = '';
      snap.forEach(doc => {
        const d = doc.data() || {};
        blocksTable.innerHTML += `
          <tr>
            <td>${d.queueType || '-'}</td>
            <td>${doc.id}</td>
            <td>${d.peopleCount || 0}</td>
            <td>${d.maxCapacity || 0}</td>
          </tr>`;
      });
    }, err => console.error('blocks listener error', err));

  // registrations listener
  regsUnsub = firestore.collection('registrations')
    .onSnapshot(snap => {
      registrationsTable.innerHTML = '';
      snap.forEach(doc => {
        const r = doc.data() || {};
        const phone = doc.id;
        const status = r.status || (r.queueType === 'priority' ? 'Pending' : 'Approved');
        let actions = '';
        if (status === 'Pending') {
          actions = `
            <button onclick="handleApprove('${phone}')">Approve</button>
            <button onclick="handleReject('${phone}')">Reject</button>`;
        }
        registrationsTable.innerHTML += `
          <tr>
            <td>${phone}</td>
            <td>${r.queueType || '-'}</td>
            <td>${r.priorityReason || '-'}</td>
            <td>${r.familyMembers || '-'}</td>
            <td>${status}</td>
            <td>${actions}</td>
          </tr>`;
      });
    }, err => console.error('registrations listener error', err));
}

// Allocation: choose least-crowded block that fits and increment using transaction
async function allocateBlock(queueType, familyMembers) {
  // query candidate blocks sorted by peopleCount asc
  const blocksQ = await firestore.collection('blocks')
    .where('queueType', '==', queueType === 'priority' ? 'priority' : 'normal')
    .orderBy('peopleCount', 'asc')
    .get();

  const candidates = [];
  blocksQ.forEach(doc => {
    const b = doc.data();
    const people = Number(b.peopleCount || 0);
    const max = Number(b.maxCapacity || 0);
    if ((people + familyMembers) <= max) candidates.push({ id: doc.id, people, max });
  });

  if (candidates.length === 0) return null;

  const chosen = candidates[0];
  const blockRef = firestore.collection('blocks').doc(chosen.id);

  try {
    const allocatedId = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(blockRef);
      const cur = snap.exists ? Number(snap.data().peopleCount || 0) : 0;
      if ((cur + familyMembers) > chosen.max) throw new Error('No capacity left');
      tx.update(blockRef, { peopleCount: cur + familyMembers });
      return chosen.id;
    });
    return allocatedId;
  } catch (err) {
    console.error('Allocation transaction error', err);
    return null;
  }
}

// Approve -> allocate and update registration
async function handleApprove(phone) {
  try {
    const regRef = firestore.collection('registrations').doc(phone);
    const regSnap = await regRef.get();
    if (!regSnap.exists) { alert('Registration not found'); return; }
    const reg = regSnap.data();
    const queueType = reg.queueType || 'normal';
    const familyMembers = Number(reg.familyMembers || 1);

    const blockId = await allocateBlock(queueType, familyMembers);
    if (blockId) {
      await regRef.update({ status: 'Approved', block: blockId, approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
      alert(`Approved ${phone} and assigned to ${blockId}`);
    } else {
      await regRef.update({ status: 'Approved', block: 'Waitlist', approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
      alert(`Approved ${phone} but no space — placed on Waitlist`);
    }
  } catch (err) {
    console.error('handleApprove err', err);
    alert('Error approving user; see console.');
  }
}
window.handleApprove = handleApprove;

// Reject -> mark rejected (TODO: if already assigned, consider decrementing block count)
async function handleReject(phone) {
  try {
    await firestore.collection('registrations').doc(phone).update({ status: 'Rejected' });
    alert(`Rejected ${phone}`);
  } catch (err) {
    console.error('handleReject err', err);
    alert('Error rejecting user; see console.');
  }
}
window.handleReject = handleReject;

// Optional: cleanup listeners if needed
function stopAdminListeners() {
  if (blocksUnsub) blocksUnsub();
  if (regsUnsub) regsUnsub();
}
window.stopAdminListeners = stopAdminListeners;

// ---------- end admin.js ----------
