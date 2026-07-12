const tierCards = document.getElementById('tier-cards');
const tierSelect = document.getElementById('tier');
const registrationForm = document.getElementById('registration-form');
const registrationMessage = document.getElementById('registration-message');
const paymentSection = document.getElementById('payment-section');
const paymentSummary = document.getElementById('payment-summary');
const payButton = document.getElementById('pay-button');
const paymentMessage = document.getElementById('payment-message');
const appointmentSection = document.getElementById('appointment-section');
const appointmentForm = document.getElementById('appointment-form');
const appointmentMessage = document.getElementById('appointment-message');
const selectedTierLabel = document.getElementById('selected-tier-label');
const appointmentDate = document.getElementById('appointment-date');
const appointmentTime = document.getElementById('appointment-time');
const appointmentAvailability = document.getElementById('appointment-availability');
const appointmentSubmitButton = document.getElementById('appointment-submit');

let currentUser = null;
let tiers = [];

async function fetchTiers() {
  const response = await fetch('/api/tiers');
  tiers = await response.json();
  tierCards.innerHTML = '';
  tierSelect.innerHTML = '<option value="">Select a tier</option>';

  tiers.forEach((tier) => {
    const card = document.createElement('article');
    card.className = 'tier-card';
    card.innerHTML = `
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

function updatePaymentSection() {
  if (!currentUser || currentUser.amountDue <= 0 || currentUser.paymentStatus !== 'pending') {
    paymentSection.hidden = true;
    return;
  }

  const tier = tiers.find((item) => item.id === currentUser.tierId);
  paymentSummary.innerHTML = `
    <p><strong>Tier:</strong> ${tier ? tier.name : currentUser.tierName}</p>
    <p><strong>Amount due:</strong> ${tier ? tier.priceLabel : `$${currentUser.amountDue}`}</p>
    <p>Click below to complete your checkout.</p>
  `;
  payButton.textContent = `Pay ${tier ? tier.priceLabel : `$${currentUser.amountDue}`}`;
  paymentSection.hidden = false;
}

function updateAppointmentSection() {
  if (!currentUser || (currentUser.paymentStatus === 'pending' && currentUser.amountDue > 0)) {
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
    updatePaymentSection();
    updateAppointmentSection();

    if (currentUser.amountDue > 0 && currentUser.paymentStatus === 'pending') {
      paymentSection.scrollIntoView({ behavior: 'smooth' });
    } else {
      appointmentSection.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (error) {
    showMessage(registrationMessage, 'Unable to complete registration.', 'error');
  }
});

payButton.addEventListener('click', async () => {
  if (!currentUser) {
    showMessage(paymentMessage, 'Please register before completing payment.', 'error');
    return;
  }

  paymentMessage.textContent = '';

  try {
    const response = await fetch('/api/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });

    const result = await response.json();
    if (!response.ok) {
      showMessage(paymentMessage, result.error || 'Payment failed.', 'error');
      return;
    }

    currentUser = result.user;
    showMessage(paymentMessage, result.message || 'Payment completed successfully.');
    updatePaymentSection();
    updateAppointmentSection();
    appointmentSection.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    showMessage(paymentMessage, 'Unable to complete payment.', 'error');
  }
});

appointmentDate.addEventListener('change', checkAvailability);
appointmentTime.addEventListener('change', checkAvailability);

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
});
