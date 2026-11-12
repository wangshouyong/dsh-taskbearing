/**
 * 样式安装与归属标记（B-63 补 / v1.32）：
 * DSH 0.2.0-rc.2 的 client-modules 会把「无主 <style>」认领给后物化的插件，
 * 那个插件重载/卸载时按 data-plugin 连带删除 → 本插件样式整块消失。
 * 这里用假 DOM 单测保证：新建即带归属、重复调用不重复插入、旧的无主 style 被补归属。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PLUGIN_ID, STYLE_ATTR, STYLE_ID, ensureStyles, installStyles } from "../src/client/styles-install.js";

function makeStyleElement(id = "") {
  return {
    id,
    tagName: "STYLE",
    textContent: "",
    isConnected: false,
    _attrs: {},
    setAttribute(name, value) {
      this._attrs[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    remove() {
      this.isConnected = false;
      this.removed = true;
    }
  };
}

function makeDoc() {
  const children = [];
  const head = {
    appendChild(el) {
      el.isConnected = true;
      children.push(el);
      return el;
    }
  };
  return {
    children,
    head,
    documentElement: head,
    createElement(tag) {
      assert.equal(tag, "style");
      return makeStyleElement();
    },
    querySelectorAll(selector) {
      assert.equal(selector, "style");
      return children.slice();
    }
  };
}

const CSS = ".dsh-compass-root { display: flex; }";

test("首次安装：创建带 data-plugin / data-plugin-css 归属标记的 style（防止被 client-modules 认领）", () => {
  const doc = makeDoc();
  assert.equal(ensureStyles(doc, CSS), true);
  assert.equal(doc.children.length, 1);
  const el = doc.children[0];
  assert.equal(el.id, STYLE_ID);
  assert.equal(el.textContent, CSS);
  assert.equal(el.getAttribute(STYLE_ATTR), "1");
  assert.equal(el.getAttribute("data-plugin"), PLUGIN_ID);
  assert.equal(el.getAttribute("data-plugin-css"), PLUGIN_ID);
});

test("重复调用幂等：不重复插入，内容变化时就地更新归属仍在", () => {
  const doc = makeDoc();
  ensureStyles(doc, CSS);
  const first = doc.children[0];
  assert.equal(ensureStyles(doc, `${CSS}\n.dsh-compass-root .tree { min-height: 0; }`), true);
  assert.equal(doc.children.length, 1, "不重复插入");
  assert.equal(doc.children[0], first);
  assert.match(first.textContent, /min-height: 0/);
  assert.equal(first.getAttribute("data-plugin"), PLUGIN_ID);
});

test("历史遗留的无主 style（只有本插件 id）：补归属并更新内容（自愈）", () => {
  const doc = makeDoc();
  const legacy = makeStyleElement(STYLE_ID); // 旧版本：没有 data-plugin
  legacy.textContent = "旧样式";
  doc.head.appendChild(legacy);
  assert.equal(ensureStyles(doc, CSS), true);
  assert.equal(doc.children.length, 1, "复用旧元素，不再插一份");
  assert.equal(legacy.getAttribute("data-plugin"), PLUGIN_ID, "补上归属，避免被别的插件认领删除");
  assert.equal(legacy.getAttribute(STYLE_ATTR), "1");
  assert.equal(legacy.textContent, CSS);
});

test("不碰其它插件的 style（无本插件 id / 标记）", () => {
  const doc = makeDoc();
  const other = makeStyleElement("someone-else-css");
  other.textContent = "other";
  other._attrs["data-plugin"] = "other-plugin";
  doc.head.appendChild(other);
  ensureStyles(doc, CSS);
  assert.equal(doc.children.length, 2);
  assert.equal(other.textContent, "other");
  assert.equal(other.getAttribute("data-plugin"), "other-plugin", "不被改成我们的归属");
});

test("空 CSS / 非文档：返回 false 且不抛错", () => {
  const doc = makeDoc();
  assert.equal(ensureStyles(doc, ""), false);
  assert.equal(ensureStyles(doc, null), false);
  assert.equal(doc.children.length, 0);
  assert.equal(ensureStyles(null, CSS), false);
  assert.equal(ensureStyles(undefined, CSS), false);
});

test("installStyles：返回 disposer 且 dispose 不删除样式（避免旧实例清理晚于新实例导致整块丢失）", () => {
  const doc = makeDoc();
  const dispose = installStyles(doc, CSS);
  assert.equal(typeof dispose, "function");
  assert.equal(doc.children.length, 1);
  dispose();
  assert.equal(doc.children.length, 1, "dispose 不删除共享样式");
  assert.equal(doc.children[0].isConnected, true);
});

test("没有 head 时退化挂到 documentElement", () => {
  const doc = makeDoc();
  doc.head = null;
  doc.documentElement = { appendChild: doc.head?.appendChild ?? ((el) => { doc.children.push(el); el.isConnected = true; }) };
  assert.equal(ensureStyles(doc, CSS), true);
  assert.equal(doc.children.length, 1);
});
