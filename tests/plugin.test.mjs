import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const compiled = await build({ entryPoints: ['src/layout.ts'], bundle: true, format: 'cjs', write: false });
const mathModule = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module: mathModule, exports: mathModule.exports });
const { targetHeights, notebookNavigatorHeights, normalizeSettings } = mathModule.exports;
const sum = values => values.reduce((a, b) => a + b, 0);

test('expansion preserves total height for uneven panes and exhausted neighbours', () => {
    for (const heights of [[200, 300], [100, 300, 200], [40, 40, 600], [20, 300, 50], [1, 1], [100, 41, 42, 500]]) {
        for (let index = 0; index < heights.length; index++) {
            for (const percentage of [4, 18, 50]) {
                const result = targetHeights(heights, index, percentage);
                assert.ok(Math.abs(sum(result) - sum(heights)) < 0.001);
                assert.ok(result[index] >= heights[index]);
                result.forEach((height, i) => {
                    assert.ok(height >= Math.min(40, heights[i]) - 0.001);
                    if (i !== index) assert.ok(height <= heights[i]);
                });
            }
        }
    }
    assert.deepEqual(Array.from(targetHeights([200, 200, 200], 1, 20)), [140, 320, 140]);
    assert.deepEqual(Array.from(targetHeights([200, 200], 0, 20)), [280, 120]);
});

test('Notebook Navigator reaches the local pane ratios without losing custom sizes', () => {
    assert.deepEqual(Array.from(notebookNavigatorHeights([300, 300], 0)), [396, 204]);
    assert.deepEqual(Array.from(notebookNavigatorHeights([180, 420], 0)), [396, 204]);
    assert.deepEqual(Array.from(notebookNavigatorHeights([300, 300, 300], 1)), [261, 378, 261]);
    assert.deepEqual(Array.from(notebookNavigatorHeights([500, 100], 0)), [500, 100]);
});

test('invalid saved settings are bounded or replaced with defaults', () => {
    for (const saved of [null, 'bad', [], { expansionAmount: NaN, transitionDuration: Infinity }]) {
        assert.equal(normalizeSettings(saved).expansionAmount, 12);
        assert.equal(normalizeSettings(saved).transitionDuration, 300);
        assert.equal(normalizeSettings(saved).notebookNavigatorSupport, true);
    }
    assert.equal(normalizeSettings({ expansionAmount: 900 }).expansionAmount, 50);
    assert.equal(normalizeSettings({ transitionDuration: -100 }).transitionDuration, 0);
    assert.equal(normalizeSettings({ notebookNavigatorSupport: false }).notebookNavigatorSupport, false);
});

async function fixture() {
    const dom = new JSDOM('<div id="workspace"><div class="workspace-split mod-left-split" style="display:flex;flex-direction:column"><div class="workspace-tabs" style="flex:2 1 0px!important"><div class="workspace-tab-header-container"></div><div class="workspace-leaf"></div></div><div class="workspace-leaf-resize-handle"></div><div class="workspace-tabs" style="flex:1 1 0px"><div class="workspace-leaf"></div></div><div class="workspace-sidedock-vault-profile" style="height:30px"></div></div><div class="workspace-split mod-root-split"><div class="workspace-tabs"></div></div></div>');
    const { window } = dom;
    Object.defineProperty(window.Node.prototype, 'win', { get() { return window; } });
    Object.defineProperty(window.Node.prototype, 'doc', { get() { return window.document; } });
    window.Node.prototype.instanceOf = function(type) { return this instanceof type; };
    const timers = new Map();
    let nextTimer = 0;
    window.setTimeout = callback => { timers.set(++nextTimer, callback); return nextTimer; };
    window.clearTimeout = id => timers.delete(id);
    const root = window.document.querySelector('#workspace');
    const panes = [...root.querySelectorAll('.mod-left-split > .workspace-tabs')];
    panes.forEach((el, i) => Object.defineProperty(el, 'offsetHeight', { get: () => i ? 200 : 400 }));
    let layoutCallback;
    let ready;
    class Plugin {
        cleanups = [];
        app = { workspace: {
            containerEl: root,
            onLayoutReady(callback) { ready = callback; },
            on(_name, callback) { layoutCallback = callback; return { off: () => { layoutCallback = undefined; } }; }
        } };
        async loadData() { return null; }
        async saveData(value) { this.saved = value; }
        addSettingTab(tab) { this.tab = tab; }
        addCommand(command) { this.command = command; }
        register(callback) { this.cleanups.push(callback); }
        registerEvent(event) { this.register(event.off); }
        registerDomEvent(el, name, callback) {
            el.addEventListener(name, callback);
            this.register(() => el.removeEventListener(name, callback));
        }
        unload() { this.onunload(); this.cleanups.splice(0).forEach(callback => callback()); }
    }
    class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
    const module = { exports: {} };
    vm.runInNewContext(readFileSync('main.js', 'utf8'), {
        module, exports: module.exports,
        require: name => { assert.equal(name, 'obsidian'); return { Plugin, PluginSettingTab, Setting: class {}, Notice: class {} }; },
        window, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
        MutationObserver: window.MutationObserver
    });
    const plugin = new module.exports.default();
    await plugin.onload();
    const mouse = (el, name, relatedTarget = null, modifiers = {}) => el.dispatchEvent(new window.MouseEvent(name, { bubbles: true, relatedTarget, ...modifiers }));
    const key = (name, key, modifiers = {}) => window.document.dispatchEvent(new window.KeyboardEvent(name, { key, bubbles: true, ...modifiers }));
    const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); };
    return { dom, window, root, panes, plugin, timers, mouse, key, flush, ready: () => ready(), layout: () => layoutCallback?.() };
}

test('hovering headers expands; leaving restores exact inline sizing and priorities', async () => {
    const f = await fixture(); f.ready();
    const before = f.panes.map(el => el.style.cssText);
    f.mouse(f.panes[0].firstElementChild, 'mouseover');
    assert.equal(f.panes[0].style.getPropertyValue('--sidebar-expand-weight'), '472');
    assert.equal(f.panes[1].style.getPropertyValue('--sidebar-expand-weight'), '128');
    f.mouse(f.panes[0].lastElementChild, 'mouseout', f.panes[0].firstElementChild);
    assert.equal(f.timers.size, 0);
    f.mouse(f.panes[0], 'mouseout'); f.flush();
    assert.deepEqual(f.panes.map(el => el.style.cssText), before);
    assert.equal(f.root.querySelectorAll('.sidebar-expand-managed').length, 0);
    assert.equal(f.root.querySelector('.workspace-sidedock-vault-profile').style.height, '30px');
    f.plugin.unload(); f.dom.window.close();
});

test('switching panes and rapid re-entry cannot leave stale expanded groups', async () => {
    const f = await fixture(); f.ready();
    f.mouse(f.panes[0], 'mouseover');
    f.mouse(f.panes[0], 'mouseout', f.panes[1]);
    f.mouse(f.panes[1], 'mouseover'); f.flush();
    assert.equal(f.panes[1].style.getPropertyValue('--sidebar-expand-weight'), '272');
    f.mouse(f.panes[1], 'mouseout'); f.mouse(f.panes[1], 'mouseover'); f.flush();
    assert.equal(f.panes[1].classList.contains('sidebar-expand-managed'), true);
    f.layout();
    assert.equal(f.root.querySelectorAll('.sidebar-expand-managed').length, 0);
    f.plugin.unload(); f.dom.window.close();
});

test('resize dragging suppresses hover; unloading cancels timers and listeners', async () => {
    const f = await fixture(); f.ready();
    f.mouse(f.panes[0], 'mouseover');
    f.mouse(f.root.querySelector('.workspace-leaf-resize-handle'), 'mousedown');
    f.mouse(f.panes[1], 'mouseover');
    assert.equal(f.root.querySelectorAll('.sidebar-expand-managed').length, 0);
    f.mouse(f.window.document, 'mouseup');
    assert.equal(f.timers.size, 1);
    f.plugin.unload();
    assert.equal(f.timers.size, 0);
    f.mouse(f.panes[0], 'mouseover'); f.flush();
    assert.equal(f.root.querySelectorAll('.sidebar-expand-managed').length, 0);
    f.dom.window.close();
});

test('unloading during hover restores custom properties and leaves no timer work', async () => {
    const f = await fixture(); f.ready();
    f.panes[0].style.setProperty('--sidebar-expand-weight', '77', 'important');
    const priority = f.panes[0].style.getPropertyPriority('--sidebar-expand-weight');
    f.mouse(f.panes[0], 'mouseover'); f.mouse(f.panes[0], 'mouseout');
    f.plugin.unload();
    assert.equal(f.panes[0].style.getPropertyValue('--sidebar-expand-weight'), '77');
    assert.equal(f.panes[0].style.getPropertyPriority('--sidebar-expand-weight'), priority);
    assert.equal(f.timers.size, 0);
    f.dom.window.close();
});

test('unloading before layout readiness never installs listeners', async () => {
    const f = await fixture(); f.plugin.unload(); f.ready();
    f.mouse(f.panes[0], 'mouseover');
    assert.equal(f.root.querySelectorAll('.sidebar-expand-managed').length, 0);
    f.dom.window.close();
});

test('closed panes are restored and editor panes are excluded', async () => {
    const f = await fixture(); f.ready();
    f.mouse(f.root.querySelector('.mod-root-split .workspace-tabs'), 'mouseover');
    assert.equal(f.root.querySelectorAll('.sidebar-expand-managed').length, 0);
    f.mouse(f.panes[0], 'mouseover'); f.panes[1].remove();
    await Promise.resolve();
    assert.equal(f.panes[0].classList.contains('sidebar-expand-managed'), false);
    assert.equal(f.panes[1].classList.contains('sidebar-expand-managed'), false);
    f.plugin.unload(); f.dom.window.close();
});

test('right sidebar and newly added vertical Notebook Navigator panes expand without changing horizontal layouts', async () => {
    const f = await fixture(); f.ready();
    const right = f.window.document.createElement('div');
    right.className = 'workspace-split mod-right-split';
    const parent = f.window.document.createElement('div');
    parent.className = 'nn-split-container';
    parent.style.flexDirection = 'column';
    right.appendChild(parent); f.root.appendChild(right);
    const panes = ['nn-navigation-pane', 'nn-list-pane'].map(className => {
        const el = f.window.document.createElement('div');
        el.className = className;
        Object.defineProperty(el, 'offsetHeight', { get: () => 300 });
        parent.appendChild(el); return el;
    });
    f.mouse(panes[0], 'mouseover');
    assert.equal(panes[0].style.getPropertyValue('--sidebar-expand-weight'), '396');
    f.mouse(panes[0], 'mouseout'); f.flush();
    parent.style.flexDirection = 'row';
    f.mouse(panes[0], 'mouseover');
    assert.equal(panes[0].classList.contains('sidebar-expand-managed'), false);
    assert.equal(parent.style.flexDirection, 'row');
    f.plugin.unload(); f.dom.window.close();
});

test('Notebook Navigator support can be disabled and geometry protects horizontal layouts', async () => {
    const f = await fixture(); f.ready();
    const parent = f.window.document.createElement('div');
    parent.className = 'nn-split-container';
    parent.style.flexDirection = 'column';
    f.root.querySelector('.mod-left-split').appendChild(parent);
    const panes = ['nn-navigation-pane', 'nn-list-pane'].map((className, index) => {
        const el = f.window.document.createElement('div');
        el.className = className;
        Object.defineProperty(el, 'offsetHeight', { get: () => 300 });
        el.getBoundingClientRect = () => ({ left: index * 300, top: 0, width: 300, height: 300 });
        parent.appendChild(el);
        return el;
    });
    f.mouse(panes[0], 'mouseover');
    assert.equal(parent.querySelectorAll('.sidebar-expand-managed').length, 0);
    panes.forEach((el, index) => { el.getBoundingClientRect = () => ({ left: 0, top: index * 300, width: 300, height: 300 }); });
    f.mouse(panes[0], 'mouseover');
    assert.equal(panes[0].style.getPropertyValue('--sidebar-expand-weight'), '396');
    f.plugin.settings.notebookNavigatorSupport = false;
    await f.plugin.saveSettings();
    assert.equal(parent.querySelectorAll('.sidebar-expand-managed').length, 0);
    f.mouse(panes[0], 'mouseover', null, { altKey: true });
    assert.equal(parent.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    f.plugin.unload(); f.dom.window.close();
});

test('release metadata and runtime imports satisfy installation requirements', () => {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
    assert.match(manifest.id, /^[a-z0-9-]+$/);
    assert.ok(!manifest.id.includes('obsidian'));
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.equal(manifest.version, pkg.version);
    assert.equal(versions[manifest.version], manifest.minAppVersion);
    assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
    assert.equal(manifest.author, 'PulseRH');
    assert.equal(manifest.isDesktopOnly, true);
    assert.ok(readFileSync('LICENSE', 'utf8').includes('MIT License'));
    const imports = [...readFileSync('main.js', 'utf8').matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]);
    assert.deepEqual(imports, ['obsidian']);
});

test('hold key overrides percentage immediately and releasing restores percentage sizing', async () => {
    const f = await fixture(); f.ready();
    f.plugin.settings.expansionAmount = 4;
    f.mouse(f.panes[0], 'mouseover');
    f.key('keydown', 'Alt', { altKey: true });
    assert.equal(f.panes[0].classList.contains('sidebar-expand-full-active'), true);
    assert.equal(f.panes[1].classList.contains('sidebar-expand-full-hidden'), true);
    assert.equal(f.panes[0].classList.contains('sidebar-expand-managed'), false);
    assert.equal(f.root.querySelector('.workspace-sidedock-vault-profile').classList.length, 1);
    f.key('keyup', 'Alt');
    assert.equal(f.root.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    assert.equal(f.panes[0].style.getPropertyValue('--sidebar-expand-weight'), '424');
    f.plugin.unload(); f.dom.window.close();
});

test('modifier already held before entering a sidebar activates full height', async () => {
    const f = await fixture(); f.ready();
    f.mouse(f.panes[1], 'mouseover', null, { altKey: true });
    assert.equal(f.panes[1].classList.contains('sidebar-expand-full-active'), true);
    f.mouse(f.panes[1], 'mouseout'); f.flush();
    assert.equal(f.root.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    f.plugin.unload(); f.dom.window.close();
});

test('toggle command persists full-height mode and has no conflicting default hotkey', async () => {
    const f = await fixture(); f.ready();
    assert.equal(f.plugin.command.id, 'toggle-full-height-hover');
    assert.equal(f.plugin.command.hotkeys, undefined);
    f.mouse(f.panes[0], 'mouseover');
    await f.plugin.command.callback();
    assert.equal(f.plugin.saved.fullHeightEnabled, true);
    assert.equal(f.panes[0].classList.contains('sidebar-expand-full-active'), true);
    f.mouse(f.panes[0], 'mouseout'); f.flush();
    f.mouse(f.panes[1], 'mouseover');
    assert.equal(f.panes[1].classList.contains('sidebar-expand-full-active'), true);
    f.key('keydown', 'Alt', { altKey: true }); f.key('keyup', 'Alt');
    assert.equal(f.panes[1].classList.contains('sidebar-expand-full-active'), true);
    await f.plugin.command.callback();
    assert.equal(f.plugin.saved.fullHeightEnabled, false);
    assert.equal(f.root.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    assert.equal(f.panes[1].style.getPropertyValue('--sidebar-expand-weight'), '272');
    f.plugin.unload(); f.dom.window.close();
});

test('nested full-height panes collapse competing groups all the way to sidebar root', async () => {
    const f = await fixture(); f.ready();
    const parent = f.window.document.createElement('div');
    parent.className = 'workspace-split'; parent.style.flexDirection = 'column';
    f.panes[0].before(parent); parent.appendChild(f.panes[0]);
    const other = f.window.document.createElement('div'); other.className = 'workspace-tabs'; parent.appendChild(other);
    f.mouse(f.panes[0], 'mouseover', null, { altKey: true });
    assert.ok(f.panes[0].classList.contains('sidebar-expand-full-active'));
    assert.ok(parent.classList.contains('sidebar-expand-full-active'));
    assert.ok(other.classList.contains('sidebar-expand-full-hidden'));
    assert.ok(f.panes[1].classList.contains('sidebar-expand-full-hidden'));
    f.plugin.unload();
    assert.equal(f.root.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    f.dom.window.close();
});

test('blur and unload clear full-height mode without leaving a stuck modifier', async () => {
    const f = await fixture(); f.ready();
    f.mouse(f.panes[0], 'mouseover', null, { altKey: true });
    f.window.dispatchEvent(new f.window.Event('blur'));
    assert.equal(f.root.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    f.mouse(f.panes[0], 'mouseover');
    assert.ok(f.panes[0].classList.contains('sidebar-expand-managed'));
    f.key('keydown', 'Alt', { altKey: true });
    f.plugin.unload();
    f.key('keydown', 'Alt', { altKey: true });
    assert.equal(f.root.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    assert.equal(f.timers.size, 0);
    f.dom.window.close();
});

test('changing or disabling the hold modifier clears its previous held state', async () => {
    const f = await fixture(); f.ready();
    f.mouse(f.panes[0], 'mouseover', null, { altKey: true });
    await f.plugin.setHoldKey('Shift');
    assert.equal(f.root.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    f.key('keydown', 'Shift', { shiftKey: true });
    assert.ok(f.panes[0].classList.contains('sidebar-expand-full-active'));
    await f.plugin.setHoldKey('None');
    f.key('keydown', 'Shift', { shiftKey: true });
    assert.equal(f.root.querySelectorAll('[class*="sidebar-expand-full-"]').length, 0);
    f.plugin.unload(); f.dom.window.close();
});

test('full-height mode restores hidden siblings if the active pane is removed', async () => {
    const f = await fixture(); f.ready();
    f.mouse(f.panes[0], 'mouseover', null, { altKey: true });
    f.panes[0].remove(); await Promise.resolve();
    assert.equal(f.panes[1].classList.contains('sidebar-expand-full-hidden'), false);
    assert.equal(f.panes[0].classList.contains('sidebar-expand-full-active'), false);
    f.plugin.unload(); f.dom.window.close();
});
