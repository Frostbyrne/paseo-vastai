Shows your Vast.ai GPU rentals in the Paseo sidebar so instances that agents start do not run unnoticed.

A sidebar footer row shows how many instances are active or stopped, the combined hourly charge, and a status dot: green when everything is running, amber while one is starting, red when one has exited while it should be running or when Vast cannot be reached. It refreshes every 30 seconds. A toast appears when an instance is created, changes state, or is destroyed.

Pressing the row opens a popover listing each instance with its label, GPU, location, state, uptime, and current hourly charge, plus your remaining credit and roughly how long it lasts at the current charge. Copy SSH puts the instance's SSH command on the clipboard. Stop and Destroy act on the instance after a second confirming press within five seconds; Destroy deletes the instance and its disk and cannot be undone. Details opens a full screen that also shows the image, disk size, instance and machine IDs, and the latest status message.

## Setup

The daemon reads the API key that the `vastai` CLI stores, from `$XDG_CONFIG_HOME/vastai/vast_api_key` or `~/.vast_api_key`. The `VAST_API_KEY` environment variable of the daemon takes precedence. Install the plugin on the daemon whose machine holds the key.

## What it sends

The daemon calls `console.vast.ai` to list your instances, read your credit balance, and stop or destroy an instance when you confirm it. The key stays on the daemon; the app receives only the instance summary. The plugin does not start instances.
