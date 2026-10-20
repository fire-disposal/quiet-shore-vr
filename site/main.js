(() => {
  const repo = 'fire-disposal/quiet-shore-vr';
  const fallback = `https://github.com/${repo}/releases/latest`;
  const versionNodes = document.querySelectorAll('[data-latest-version]');
  const releaseLink = document.querySelector('[data-release-link]');
  const checksum = document.querySelector('[data-checksum]');
  const downloads = {
    headset: document.querySelector('[data-download="headset"]'),
    control: document.querySelector('[data-download="control"]')
  };
  const install = {
    headset: document.querySelector('[data-install-headset]'),
    control: document.querySelector('[data-install-control]')
  };

  function applyVersion(tag, headsetHref, controlHref, checksumHref, headsetName, controlName) {
    versionNodes.forEach((node) => { node.textContent = tag; });
    if (downloads.headset && headsetHref) downloads.headset.href = headsetHref;
    if (downloads.control && controlHref) downloads.control.href = controlHref;
    if (checksum && checksumHref) checksum.href = checksumHref;
    if (install.headset) install.headset.textContent = `adb install -r ${headsetName}`;
    if (install.control) install.control.textContent = `adb install -r ${controlName}`;
  }

  function fetchGitHub() {
    fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('release unavailable')))
      .then((release) => {
        const tag = release.tag_name || 'latest';
        if (releaseLink) releaseLink.href = release.html_url || fallback;
        const assets = Array.isArray(release.assets) ? release.assets : [];
        const find = (prefix) => assets.find((asset) => asset.name.startsWith(prefix));
        const headset = find('quiet-shore-headset-');
        const control = find('quiet-shore-control-');
        const sums = assets.find((asset) => asset.name === 'SHA256SUMS.txt');
        const stableHeadset = assets.find((asset) => asset.name === 'quiet-shore-headset.apk');
        const stableControl = assets.find((asset) => asset.name === 'quiet-shore-control.apk');
        applyVersion(
          tag,
          (stableHeadset || headset || {}).browser_download_url || fallback,
          (stableControl || control || {}).browser_download_url || fallback,
          (sums || {}).browser_download_url || fallback,
          headset ? headset.name : 'quiet-shore-headset.apk',
          control ? control.name : 'quiet-shore-control.apk'
        );
      })
      .catch(() => {
        versionNodes.forEach((node) => { node.textContent = '最新版本'; });
        if (releaseLink) releaseLink.href = fallback;
        if (checksum) checksum.href = fallback;
        if (install.headset) install.headset.textContent = 'adb install -r quiet-shore-headset.apk';
        if (install.control) install.control.textContent = 'adb install -r quiet-shore-control.apk';
      });
  }

  // Prefer the local mirror, but never let an absent/stale manifest block downloads.
  fetch('downloads/manifest.json', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('no mirror')))
    .then((manifest) => {
      if (!manifest || !manifest.version) throw new Error('empty mirror');
      applyVersion(
        manifest.version,
        'downloads/quiet-shore-headset.apk',
        'downloads/quiet-shore-control.apk',
        'downloads/SHA256SUMS.txt',
        'quiet-shore-headset.apk',
        'quiet-shore-control.apk'
      );
      if (releaseLink) releaseLink.href = fallback;
    })
    .catch(fetchGitHub);
})();
