window.addEventListener('load', function() {

	document.addEventListener('dragstart', function(event) {

		event.preventDefault();
		return false;
        
	});

	document.addEventListener('selectstart', function(event) {

		if(event.target.tagName.toLowerCase() === 'input') return true;

		event.preventDefault();
		return false;

	});

	document.addEventListener('contextmenu', function(event) {

		event.preventDefault();
		return false;

	});

	const blockedKeys = [
		{
			alt: false,
			ctrl: true,
			shift: false,
			key: 'Slash'
		},
		{
			alt: false,
			ctrl: true,
			shift: false,
			key: 'Equal'
		},
		{
			alt: false,
			ctrl: true,
			shift: false,
			key: 'Backquote'
		},
		{
			alt: false,
			ctrl: true,
			shift: false,
			key: 'KeyR'
		}
	];

	document.addEventListener('keydown', function(event) {

		for(let blockedKey of blockedKeys) {
			if(blockedKey.alt === event.altKey && blockedKey.ctrl === event.ctrlKey && blockedKey.shift === event.shiftKey && blockedKey.key === event.code) {
				event.preventDefault();
				return false;
			}
		}

		return true;

	});

	const closeBtn = document.getElementById('close-btn');

	if(closeBtn !== null) {

		closeBtn.addEventListener('click', function(event) {
			event.preventDefault();
			window.close();
		});

	}
    
});