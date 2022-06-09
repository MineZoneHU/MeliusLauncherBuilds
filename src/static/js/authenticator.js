window.addEventListener('load', function() {

	const loginForm = document.getElementById('login-form');
	const usernameInput = document.getElementById('username-input');
	const passwordInput = document.getElementById('password-input');

	const registerLink = document.getElementById('register-link');
	const passwordReminderLink = document.getElementById('password-reminder-link');

	loginForm.addEventListener('submit', function(event) {

		event.preventDefault();

		ipcRenderer.send('authenticate-with-credentials', {
			username: usernameInput.value,
			password: passwordInput.value
		});

	});

	registerLink.addEventListener('click', function(event) {
		
		event.preventDefault();

		ipcRenderer.send('open-external-website', {
			website: 'registrationPage'
		});

	});

	passwordReminderLink.addEventListener('click', function(event) {
		
		event.preventDefault();

		ipcRenderer.send('open-external-website', {
			website: 'forgotPasswordPage'
		});

	});

});