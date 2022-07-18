window.addEventListener('load', function() {

	let interactionsDisabled = false;

	let receivedUserData = false;

	let currentScreen = 'launch';
	let switchScreenInProgress = false;

	let currentMemorySetting = 0;

	const memorySettingSlider = document.getElementById('memory-setting-slider');
	const memorySettingSliderValueLabel = document.getElementById('memory-setting-slider-value-label');

	memorySettingSliderValueLabel.innerHTML = '0 MiB';

	memorySettingSlider.addEventListener('mousemove', function(event) {

		if(interactionsDisabled || !receivedUserData || event.target.value === currentMemorySetting) return;

		currentMemorySetting = parseInt(event.target.value);
		memorySettingSliderValueLabel.innerHTML = currentMemorySetting + ' MiB';

		ipcRenderer.send('set-setting', {
			name: 'clientJVMMemory',
			value: currentMemorySetting
		});

	});

	document.querySelector('*[data-action="switch-screen"][data-action-target-screen="' + currentScreen + '"]').classList.add('active');

	document.querySelectorAll('.screen').forEach(function(screenElement) {

		if(screenElement.id === currentScreen + '-screen') {

			screenElement.style.opacity = '1';
			screenElement.style.display = 'block';

		} else {

			screenElement.style.opacity = '0';
			screenElement.style.display = 'none';

		}

	});

	const switchScreen = function(targetScreen) {

		if(switchScreenInProgress || currentScreen === targetScreen) return;

		switchScreenInProgress = true;

		let currentScreenElement = document.getElementById(currentScreen + '-screen');
		let targetScreenElement = document.getElementById(targetScreen + '-screen');
        
		let currentScreenSwitcherElement = document.querySelector('*[data-action="switch-screen"][data-action-target-screen="' + currentScreen + '"]');
		let targetScreenSwitcherElement = document.querySelector('*[data-action="switch-screen"][data-action-target-screen="' + targetScreen + '"]');
        
		currentScreenSwitcherElement.classList.remove('active');
		targetScreenSwitcherElement.classList.add('active');

		let currentScreenFadeOutAnimation = currentScreenElement.animate([
			{
				opacity: '1'
			},
			{
				opacity: '0'
			}
		], {
			easing: 'ease-in-out',
			iterations: 1,
			duration: 175
		});

		currentScreenFadeOutAnimation.addEventListener('finish', function() {

			currentScreenElement.style.opacity = '0';
			currentScreenElement.style.display = 'none';
            
			targetScreenElement.style.display = 'block';

			let targetScreenFadeInAnimation = targetScreenElement.animate([
				{
					opacity: '0'
				},
				{
					opacity: '1'
				}
			], {
				easing: 'ease-in-out',
				iterations: 1,
				duration: 175
			});

			targetScreenFadeInAnimation.addEventListener('finish', function() {

				targetScreenElement.style.opacity = '1';

				currentScreen = targetScreen;

				switchScreenInProgress = false;

			});

		});
	}

	document.querySelectorAll('*[data-action]').forEach(function(element) {
        
		element.addEventListener('click', function(event) {

			event.preventDefault();

			if(interactionsDisabled) return false;

			switch(event.target.getAttribute('data-action')) {

				case 'logout':
					ipcRenderer.send('logout');
					break;

				case 'launch-game':
					interactionsDisabled = true;
					document.querySelector('*[data-action="launch-game"]').style.cursor = 'wait';
					document.querySelector('*[data-action="launch-game"]').style.filter = 'grayscale(100%)';
					ipcRenderer.send('launch-game');
					break;

				case 'switch-screen':
					switchScreen(event.target.getAttribute('data-action-target-screen'));
					break;

			}

		});

	});

	ipcRenderer.on('user-data', function(event, message) {

		if(receivedUserData) return;

		receivedUserData = true;

		if(message.maxMemory < message.currentMemorySetting) {

			currentMemorySetting = message.maxMemory;

		} else if(message.minMemory > message.currentMemorySetting) {

			currentMemorySetting = message.minMemory;

		} else {

			currentMemorySetting = message.currentMemorySetting;

		}

		ipcRenderer.send('set-setting', {
			name: 'clientJVMMemory',
			value: currentMemorySetting
		});

		memorySettingSlider.min = message.minMemory;
		memorySettingSlider.max = message.maxMemory;
		memorySettingSlider.value = currentMemorySetting;

		memorySettingSliderValueLabel.innerHTML = currentMemorySetting + ' MiB';

		document.getElementById('profile-icon').src = message.profileIconSrc;

		document.getElementById('profile-label-wrapper').innerHTML = message.username;

	});

	const onlineCountLabel = this.document.getElementById('online-count-label');

	ipcRenderer.on('online-count', function(event, onlineCount) {

		onlineCountLabel.innerHTML = (isNaN(onlineCount) || onlineCount < 0) ? 0 : onlineCount; 

	});

	ipcRenderer.on('game-exit', function(event) {

		interactionsDisabled = false;
		document.querySelector('*[data-action="launch-game"]').style.cursor = '';
		document.querySelector('*[data-action="launch-game"]').style.filter = '';

	});

	ipcRenderer.send('request-user-data');

});