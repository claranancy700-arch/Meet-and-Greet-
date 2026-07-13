const heroCanvas = document.getElementById('hero-canvas');
const tierCards = document.getElementById('tier-cards');
const tierSelect = document.getElementById('tier');
const registrationForm = document.getElementById('registration-form');
const registrationMessage = document.getElementById('registration-message');
const paymentModalBackdrop = document.getElementById('payment-modal-backdrop');
const paymentModalClose = document.getElementById('payment-modal-close');
const paymentSummary = document.getElementById('payment-summary');
const paymentForm = document.getElementById('payment-form');
const paymentMessage = document.getElementById('payment-message');
const appointmentSection = document.getElementById('appointment-section');
const appointmentForm = document.getElementById('appointment-form');
const appointmentMessage = document.getElementById('appointment-message');
const selectedTierLabel = document.getElementById('selected-tier-label');
const appointmentDate = document.getElementById('appointment-date');
const appointmentTime = document.getElementById('appointment-time');
const appointmentAvailability = document.getElementById('appointment-availability');
const appointmentSubmitButton = document.getElementById('appointment-submit');
const refundLookupForm = document.getElementById('refund-lookup-form');
const refundLookupMessage = document.getElementById('refund-lookup-message');
const refundModalBackdrop = document.getElementById('refund-modal-backdrop');
const refundModalClose = document.getElementById('refund-modal-close');
const refundSummary = document.getElementById('refund-summary');
const refundForm = document.getElementById('refund-form');
const refundMessage = document.getElementById('refund-message');
const refundEmailInput = document.getElementById('refund-email');
const refundReasonInput = document.getElementById('refund-reason');

let currentUser = null;
let tiers = [];
let refundContext = null;

const TIER_IMAGE_FALLBACKS = {
  standard: 'images/Standard.jpg',
  premium: 'images/Premuim.jpg',
  vip: 'images/VIP.jpg'
};

function drawHeroCanvas() {
  if (!heroCanvas) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = heroCanvas.getBoundingClientRect();
  heroCanvas.width = rect.width * dpr;
  heroCanvas.height = rect.height * dpr;
  const ctx = heroCanvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.45)');
  gradient.addColorStop(0.4, 'rgba(34, 197, 94, 0.24)');
  gradient.addColorStop(1, 'rgba(244, 63, 94, 0.12)');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const circles = [
    { x: width * 0.15, y: height * 0.3, r: 54, color: 'rgba(59, 130, 246, 0.18)' },
    { x: width * 0.68, y: height * 0.2, r: 82, color: 'rgba(14, 165, 233, 0.14)' },
    { x: width * 0.5, y: height * 0.65, r: 96, color: 'rgba(16, 185, 129, 0.12)' }
  ];

  circles.forEach((circle) => {
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    ctx.fillStyle = circle.color;
    ctx.fill();
  });
}

async function fetchTiers() {
  const response = await fetch('/api/tiers');
  tiers = await response.json();
  tierCards.innerHTML = '';
  tierSelect.innerHTML = '<option value="">Select a tier</option>';

  tiers.forEach((tier) => {
    const card = document.createElement('article');
    card.className = 'tier-card';
    card.innerHTML = `
      <div class="tier-image-frame">
        <img src="${tier.image || TIER_IMAGE_FALLBACKS[tier.id] || `images/${tier.name}.jpg`}" alt="${tier.name}" class="tier-image" />
      </div>
      <div class="tier-top">
        <h3>${tier.name}</h3>
        <span class="tier-price">${tier.priceLabel}</span>
      </div>
      <p>${tier.description}</p>
      <ul>${tier.perks.map((perk) => `<li>${perk}</li>`).join('')}</ul>
      <button type="button" data-tier-id="${tier.id}">Select tier</button>
    `;
    card.querySelector('button').addEventListener('click', () => {
      tierSelect.value = tier.id;
      tierSelect.focus();
    });
    tierCards.appendChild(card);

    const option = document.createElement('option');
    option.value = tier.id;
    option.textContent = `${tier.name} — ${tier.priceLabel}`;
    tierSelect.appendChild(option);
  });
}

function showMessage(element, text, type = 'success') {
  element.textContent = text;
  element.className = `message ${type}`;
}

function setPaymentModalVisible(visible) {
  if (visible) {
    setRefundModalVisible(false);
    paymentModalBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    paymentModalBackdrop.scrollTop = 0;
  } else {
    paymentModalBackdrop.hidden = true;
    if (!refundModalBackdrop || refundModalBackdrop.hidden) {
      document.body.style.overflow = '';
    }
  }
}

function setRefundModalVisible(visible) {
  if (!refundModalBackdrop) return;
  if (visible) {
    setPaymentModalVisible(false);
    refundModalBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    refundModalBackdrop.scrollTop = 0;
  } else {
    refundModalBackdrop.hidden = true;
    if (!paymentModalBackdrop || paymentModalBackdrop.hidden) {
      document.body.style.overflow = '';
    }
  }
}

function formatMoneyLabel(amount) {
  const value = Number(amount || 0);
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function openRefundGateway(user, reason = '') {
  const tier = tiers.find((item) => item.id === user.tierId);
  // Prefer live tier pricing so refund UI never shows a stale registration amount.
  const refundAmount = tier ? tier.price : user.amountDue;
  const refundAmountLabel = tier ? tier.priceLabel : formatMoneyLabel(user.amountDue);

  refundContext = {
    email: user.email,
    user: { ...user, amountDue: refundAmount, tierName: tier ? tier.name : user.tierName },
    reason
  };

  refundSummary.innerHTML = `
    <p><strong>Name:</strong> ${user.name}</p>
    <p><strong>Email:</strong> ${user.email}</p>
    <p><strong>Tier:</strong> ${tier ? tier.name : user.tierName}</p>
    <p><strong>Refund amount:</strong> ${refundAmountLabel}</p>
    <p>Enter card details to authorize your refund through GatePay.</p>
  `;
  refundMessage.textContent = '';
  refundForm?.reset();
  setRefundModalVisible(true);
}

function updatePaymentModal() {
  if (!currentUser || currentUser.amountDue <= 0 || currentUser.paymentStatus !== 'pending') {
    setPaymentModalVisible(false);
    return;
  }

  const tier = tiers.find((item) => item.id === currentUser.tierId);
  const amountLabel = tier ? tier.priceLabel : formatMoneyLabel(currentUser.amountDue);
  paymentSummary.innerHTML = `
    <p><strong>Tier:</strong> ${tier ? tier.name : currentUser.tierName}</p>
    <p><strong>Amount due:</strong> ${amountLabel}</p>
    <p>Enter card details to complete your checkout.</p>
  `;
  setPaymentModalVisible(true);
}

function updateAppointmentSection() {
  if (
    !currentUser ||
    currentUser.paymentStatus === 'refunded' ||
    (currentUser.paymentStatus === 'pending' && currentUser.amountDue > 0)
  ) {
    appointmentSection.hidden = true;
    return;
  }

  selectedTierLabel.textContent = currentUser.tierName;
  appointmentSection.hidden = false;
}

async function checkAvailability() {
  appointmentAvailability.textContent = '';
  appointmentSubmitButton.disabled = false;

  const date = appointmentDate.value;
  const time = appointmentTime.value;
  if (!date || !time) {
    return;
  }

  try {
    const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`);
    const result = await response.json();
    if (!response.ok) {
      showMessage(appointmentAvailability, result.error || 'Unable to check availability.', 'error');
      appointmentSubmitButton.disabled = true;
      return;
    }

    if (result.remaining > 0) {
      appointmentAvailability.textContent = `${result.remaining} spot${result.remaining === 1 ? '' : 's'} left for ${time} on ${date}.`;
      appointmentAvailability.className = 'availability-badge available';
    } else {
      appointmentAvailability.textContent = 'This slot is full. Please choose another time.';
      appointmentAvailability.className = 'availability-badge sold-out';
      appointmentSubmitButton.disabled = true;
    }
  } catch (error) {
    appointmentAvailability.textContent = 'Unable to check availability right now.';
    appointmentAvailability.className = 'availability-badge error';
    appointmentSubmitButton.disabled = true;
  }
}

registrationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  registrationMessage.textContent = '';
  paymentMessage.textContent = '';
  appointmentMessage.textContent = '';

  const formData = new FormData(registrationForm);
  const data = {
    name: formData.get('name').trim(),
    email: formData.get('email').trim(),
    phone: formData.get('phone').trim(),
    tierId: formData.get('tier')
  };

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (!response.ok) {
      showMessage(registrationMessage, result.error || 'Registration failed.', 'error');
      return;
    }

    currentUser = result.user;
    showMessage(registrationMessage, result.message || 'Registration successful!');
    updatePaymentModal();
    updateAppointmentSection();

    if (currentUser.amountDue > 0 && currentUser.paymentStatus === 'pending') {
      paymentModalBackdrop.scrollIntoView({ behavior: 'smooth' });
    } else {
      appointmentSection.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (error) {
    showMessage(registrationMessage, 'Unable to complete registration.', 'error');
  }
});

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentUser) {
    showMessage(paymentMessage, 'Please register before completing payment.', 'error');
    return;
  }

  paymentMessage.textContent = '';

  const formData = new FormData(paymentForm);
  const payload = {
    userId: currentUser.id,
    cardName: formData.get('cardName').trim(),
    cardNumber: formData.get('cardNumber').trim(),
    expiry: formData.get('expiry').trim(),
    cvc: formData.get('cvc').trim()
  };

  if (!payload.cardName || !payload.cardNumber || !payload.expiry || !payload.cvc) {
    showMessage(paymentMessage, 'Please fill in all card details.', 'error');
    return;
  }

  try {
    const response = await fetch('/api/mock-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      showMessage(paymentMessage, result.error || 'Payment failed.', 'error');
      return;
    }

    currentUser = result.user;
    showMessage(paymentMessage, result.message || 'Payment completed successfully.');
    paymentForm.reset();
    setPaymentModalVisible(false);
    updateAppointmentSection();
    appointmentSection.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    showMessage(paymentMessage, 'Unable to complete payment.', 'error');
  }
});

paymentModalClose.addEventListener('click', () => setPaymentModalVisible(false));

paymentModalBackdrop.addEventListener('click', (event) => {
  if (event.target === paymentModalBackdrop) {
    setPaymentModalVisible(false);
  }
});

refundModalClose?.addEventListener('click', () => setRefundModalVisible(false));

refundModalBackdrop?.addEventListener('click', (event) => {
  if (event.target === refundModalBackdrop) {
    setRefundModalVisible(false);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setPaymentModalVisible(false);
    setRefundModalVisible(false);
  }
});

appointmentDate.addEventListener('change', checkAvailability);
appointmentTime.addEventListener('change', checkAvailability);

function bindCardInputFilters(form) {
  form?.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      if (input.name === 'cardName' || input.id.includes('card-name')) {
        input.value = input.value.replace(/[^a-zA-Z\s'\-\.]/g, '');
      } else {
        input.value = input.value.replace(/[^0-9\/\s]/g, '');
      }
    });
  });
}

bindCardInputFilters(paymentForm);
bindCardInputFilters(refundForm);

refundLookupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  refundLookupMessage.textContent = '';

  const email = refundEmailInput.value.trim();
  const reason = refundReasonInput.value.trim();
  if (!email) {
    showMessage(refundLookupMessage, 'Enter the email used for registration.', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/users/${encodeURIComponent(email)}`);
    const result = await response.json();
    if (!response.ok) {
      showMessage(refundLookupMessage, result.error || 'Registration not found.', 'error');
      return;
    }

    if (result.paymentStatus === 'refunded') {
      showMessage(refundLookupMessage, 'A refund has already been processed for this registration.', 'error');
      return;
    }

    if (result.paymentStatus !== 'paid') {
      showMessage(refundLookupMessage, 'Only paid registrations can apply for a refund.', 'error');
      return;
    }

    showMessage(refundLookupMessage, 'Registration found. Opening secure refund gateway…', 'success');
    openRefundGateway(result, reason);
  } catch (error) {
    showMessage(refundLookupMessage, 'Unable to start refund request.', 'error');
  }
});

refundForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!refundContext?.email) {
    showMessage(refundMessage, 'Start from the Apply for refund section first.', 'error');
    return;
  }

  refundMessage.textContent = '';
  const formData = new FormData(refundForm);
  const payload = {
    email: refundContext.email,
    cardName: formData.get('cardName').trim(),
    cardNumber: formData.get('cardNumber').trim(),
    expiry: formData.get('expiry').trim(),
    cvc: formData.get('cvc').trim(),
    reason: refundContext.reason || ''
  };

  if (!payload.cardName || !payload.cardNumber || !payload.expiry || !payload.cvc) {
    showMessage(refundMessage, 'Please fill in all card details.', 'error');
    return;
  }

  try {
    const response = await fetch('/api/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      showMessage(refundMessage, result.error || 'Refund failed.', 'error');
      return;
    }

    if (currentUser && currentUser.email?.toLowerCase() === result.user.email.toLowerCase()) {
      currentUser = result.user;
      updateAppointmentSection();
    }

    showMessage(refundMessage, result.message || 'Refund completed successfully.');
    showMessage(refundLookupMessage, result.message || 'Refund completed successfully.', 'success');
    refundForm.reset();
    refundContext = null;
    setTimeout(() => setRefundModalVisible(false), 1400);
  } catch (error) {
    showMessage(refundMessage, 'Unable to complete refund.', 'error');
  }
});

appointmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  appointmentMessage.textContent = '';

  if (!currentUser) {
    showMessage(appointmentMessage, 'Please complete registration first.', 'error');
    return;
  }

  if (currentUser.paymentStatus === 'pending') {
    showMessage(appointmentMessage, 'Please complete payment before booking an appointment.', 'error');
    return;
  }

  const formData = new FormData(appointmentForm);
  const data = {
    userId: currentUser.id,
    date: formData.get('date'),
    time: formData.get('time'),
    notes: formData.get('notes').trim()
  };

  try {
    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (!response.ok) {
      showMessage(appointmentMessage, result.error || 'Appointment booking failed.', 'error');
      return;
    }

    showMessage(appointmentMessage, result.message || 'Appointment booked successfully!');
    appointmentForm.reset();
    appointmentAvailability.textContent = '';
  } catch (error) {
    showMessage(appointmentMessage, 'Unable to book the appointment.', 'error');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  fetchTiers();
  drawHeroCanvas();
});

window.addEventListener('resize', () => {
  drawHeroCanvas();
});
