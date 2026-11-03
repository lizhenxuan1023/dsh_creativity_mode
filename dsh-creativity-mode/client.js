window.__ModuleLoader__.load({
  id: '@local/dsh-creativity-mode',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Locale namespace owned by this plugin (also the slot `locale`). */
    const NS = 'creativity';
    /** Selectable modes in display order. */
    const MODES = ['divergent', 'balanced', 'faithful'];
    const DEFAULT_MODE = 'balanced';
    /** Popup width in px; fixed so the anchor can be clamped before paint. */
    const MENU_WIDTH = 216;
    /** Gap between the menu and its trigger. */
    const MENU_GAP = 6;

    const zh = {
      'level.divergent': '发散',
      'level.balanced': '平衡',
      'level.faithful': '忠实',
      'chip.title': '创意程度：{level} — 点击选择档位',
      'chip.aria': '创意程度：{level}，打开选项',
      'chip.failed': '切换失败',
      'chip.unknown': '未知指令：/creativity',
      'menu.label': '创意程度',
    };
    const en = {
      'level.divergent': 'Divergent',
      'level.balanced': 'Balanced',
      'level.faithful': 'Faithful',
      'chip.title': 'Creativity: {level} — click to choose a level',
      'chip.aria': 'Creativity level: {level}, open options',
      'chip.failed': 'Switch failed',
      'chip.unknown': 'Unknown command: /creativity',
      'menu.label': 'Creativity level',
    };

    const CSS = [
      '.creativity-mode-wrap{display:inline-flex;align-items:center;gap:4px;}',
      '.creativity-mode-trigger{display:inline-flex;align-items:center;gap:4px;height:28px;',
      'padding:0 4px 0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;',
      'color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:400;',
      'line-height:20px;cursor:pointer;}',
      '.creativity-mode-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
      '.creativity-mode-trigger:focus-visible{outline:none;',
      'box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}',
      '.creativity-mode-trigger:disabled{opacity:.6;cursor:default;}',
      '.creativity-mode-glyph{display:inline-flex;flex:none;width:14px;height:14px;color:currentColor;}',
      '.creativity-mode-trigger[data-level="divergent"] .creativity-mode-glyph{color:var(--dsw-alias-brand-primary);}',
      '.creativity-mode-chevron{display:inline-flex;flex:none;width:12px;height:12px;',
      'color:var(--dsw-alias-label-caption);transition:transform .12s;}',
      '.creativity-mode-chevron[data-open="true"]{transform:rotate(180deg);}',
      '.creativity-mode-menu{position:fixed;z-index:1100;box-sizing:border-box;display:flex;',
      'flex-direction:column;gap:1px;padding:4px;border-radius:var(--dsw-radius-lg);',
      'background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-elevation-prominent);',
      'color:var(--dsw-alias-label-primary);}',
      '.creativity-mode-item{box-sizing:border-box;display:flex;align-items:center;gap:8px;',
      'min-height:34px;width:100%;padding:5px 8px;border:none;border-radius:var(--dsw-radius-md);',
      'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;',
      'font-weight:400;line-height:20px;text-align:left;cursor:pointer;}',
      '.creativity-mode-item:hover,.creativity-mode-item:focus-visible{',
      'background:var(--dsw-alias-interactive-bg-hover);outline:none;}',
      '.creativity-mode-item[aria-checked="true"]{font-weight:500;}',
      '.creativity-mode-item-icon{display:inline-flex;flex:none;width:16px;height:16px;',
      'color:var(--dsw-alias-label-secondary);}',
      '.creativity-mode-item[data-level="divergent"] .creativity-mode-item-icon{',
      'color:var(--dsw-alias-brand-primary);}',
      '.creativity-mode-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;',
      'white-space:nowrap;}',
      '.creativity-mode-item-check{display:inline-grid;place-items:center;flex:none;width:14px;',
      'height:14px;color:var(--dsw-alias-label-primary);}',
      '.creativity-mode-failure{color:var(--dsw-alias-state-error-primary);font-size:12px;',
      'line-height:18px;}',
    ].join('');

    /** Insert the plugin stylesheet once per page load; returns its remover. */
    function insertStyles() {
      if (typeof document === 'undefined') return () => {};
      const tagId = '@local/dsh-creativity-mode/chip.css';
      const existing = document.querySelector('style[data-plugin-css="' + tagId + '"]');
      if (existing !== null) {
        return () => {
          existing.remove();
        };
      }
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-creativity-mode';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.append(tag);
      return () => {
        tag.remove();
      };
    }

    /**
     * One mode glyph: spark for divergent, equals for balanced, document sheet
     * for faithful. The check belongs to the menu's selected marker.
     */
    function glyph(mode) {
      const shell = { viewBox: '0 0 24 24', width: '100%', height: '100%', 'aria-hidden': true, focusable: false };
      if (mode === 'divergent') {
        return h(
          'svg',
          shell,
          h('path', {
            d: 'M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z',
            fill: 'currentColor',
          }),
        );
      }
      if (mode === 'faithful') {
        const stroke = {
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        };
        return h(
          'svg',
          shell,
          h('rect', { x: 5, y: 3.5, width: 14, height: 17, rx: 2, ...stroke }),
          h('path', { d: 'M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5', ...stroke }),
        );
      }
      return h(
        'svg',
        shell,
        h('path', {
          d: 'M4 9h16M4 15h16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
        }),
      );
    }

    /** Selected-row check mark. */
    function checkGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: '100%', height: '100%', 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M4 12.5l5 5L20 6.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /** Down chevron for the trigger, matching the composer's other selectors. */
    function chevronGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: '100%', height: '100%', 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M6 9l6 6 6-6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands'],
      apply(ctx) {
        ctx.effect(() => insertStyles(), 'creativity-mode: styles');
        ctx.effect(
          () => ctx.locale.register(NS, { zh, en }),
          'creativity-mode: dictionaries',
        );
        const t = ctx.locale.bind(NS);

        /**
         * Composer control: a trigger that opens the mode card above itself,
         * like the permission selector. The mode is read from the Host-folded
         * `creativity` projection, so a click and a slash command always agree.
         */
        function CreativityControl({ useProjection, sessionId }) {
          const view = useProjection('creativity');
          const [open, setOpen] = React.useState(false);
          const [anchor, setAnchor] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [failure, setFailure] = React.useState(null);
          const triggerRef = React.useRef(null);
          const menuRef = React.useRef(null);
          const alive = React.useRef(true);

          React.useEffect(() => {
            alive.current = true;
            return () => {
              alive.current = false;
            };
          }, []);

          const mode =
            view !== undefined && view !== null && typeof view.mode === 'string'
              ? view.mode
              : DEFAULT_MODE;

          /** Anchor the card above the trigger, clamped into the viewport. */
          const place = React.useCallback(() => {
            const trigger = triggerRef.current;
            if (trigger === null) return;
            const rect = trigger.getBoundingClientRect();
            const maxLeft = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
            const left = Math.min(Math.max(8, rect.left), maxLeft);
            const bottom = Math.max(8, window.innerHeight - rect.top + MENU_GAP);
            setAnchor((previous) =>
              previous !== null && previous.left === left && previous.bottom === bottom
                ? previous
                : { left, bottom },
            );
          }, []);

          /** Compute the anchor before opening so the card mounts in the same commit. */
          const toggle = () => {
            if (open) {
              setOpen(false);
              return;
            }
            place();
            setOpen(true);
          };

          React.useEffect(() => {
            if (!open) return undefined;
            place();
            const onPointerDown = (event) => {
              const menu = menuRef.current;
              const trigger = triggerRef.current;
              if (menu !== null && event.target instanceof Node && menu.contains(event.target)) return;
              if (trigger !== null && event.target instanceof Node && trigger.contains(event.target)) return;
              setOpen(false);
            };
            const onKeyDown = (event) => {
              if (event.key !== 'Escape') return;
              setOpen(false);
              triggerRef.current?.focus();
            };
            const reposition = () => {
              const trigger = triggerRef.current;
              if (trigger === null) return;
              const rect = trigger.getBoundingClientRect();
              if (rect.bottom < 0 || rect.top > window.innerHeight) {
                setOpen(false);
                return;
              }
              place();
            };
            document.addEventListener('mousedown', onPointerDown, true);
            document.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('resize', reposition);
            window.addEventListener('scroll', reposition, true);
            return () => {
              document.removeEventListener('mousedown', onPointerDown, true);
              document.removeEventListener('keydown', onKeyDown, true);
              window.removeEventListener('resize', reposition);
              window.removeEventListener('scroll', reposition, true);
            };
          }, [open, place]);

          // Focus the selected option once the card is in the page.
          React.useEffect(() => {
            if (!open || anchor === null) return;
            const menu = menuRef.current;
            if (menu === null) return;
            const target =
              menu.querySelector('[role="menuitemradio"][aria-checked="true"]') ??
              menu.querySelector('[role="menuitemradio"]');
            if (target instanceof HTMLElement) target.focus();
          }, [open, anchor]);

          if (view === undefined || view === null) return null;

          const choose = (next) => {
            setOpen(false);
            triggerRef.current?.focus();
            if (busy || next === mode) return;
            setBusy(true);
            setFailure(null);
            ctx.remote.commands.execute(sessionId, '/creativity ' + next, []).then(
              (result) => {
                if (!alive.current) return;
                setBusy(false);
                if (result === undefined) {
                  setFailure(t('chip.unknown'));
                  return;
                }
                if (!result.ok) {
                  setFailure(result.error.message + ' (' + result.error.code + ')');
                  return;
                }
                setFailure(null);
              },
              (reason) => {
                if (!alive.current) return;
                setBusy(false);
                setFailure(reason instanceof Error ? reason.message : String(reason));
              },
            );
          };

          const onMenuKeyDown = (event) => {
            const menu = menuRef.current;
            if (menu === null) return;
            const items = Array.from(menu.querySelectorAll('[role="menuitemradio"]'));
            if (items.length === 0) return;
            const index = items.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              items[(index + 1) % items.length].focus();
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              items[(index - 1 + items.length) % items.length].focus();
            } else if (event.key === 'Home') {
              event.preventDefault();
              items[0].focus();
            } else if (event.key === 'End') {
              event.preventDefault();
              items[items.length - 1].focus();
            } else if (event.key === 'Tab') {
              setOpen(false);
            }
          };

          const label = t('level.' + mode);

          return h(
            'span',
            { className: 'creativity-mode-wrap' },
            h(
              'button',
              {
                ref: triggerRef,
                type: 'button',
                className: 'creativity-mode-trigger',
                'data-level': mode,
                'aria-haspopup': 'menu',
                'aria-expanded': open ? 'true' : 'false',
                'aria-label': t('chip.aria', { level: label }),
                title: t('chip.title', { level: label }),
                disabled: busy,
                onClick: toggle,
              },
              h('span', { className: 'creativity-mode-glyph' }, glyph(mode)),
              label,
              h('span', { className: 'creativity-mode-chevron', 'data-open': open ? 'true' : 'false' }, chevronGlyph()),
            ),
            failure === null
              ? null
              : h(
                  'span',
                  { className: 'creativity-mode-failure', role: 'status', title: failure },
                  t('chip.failed'),
                ),
            open && anchor !== null
              ? ReactDOM.createPortal(
                  h(
                    'div',
                    {
                      ref: menuRef,
                      className: 'creativity-mode-menu',
                      role: 'menu',
                      'aria-label': t('menu.label'),
                      style: {
                        left: anchor.left + 'px',
                        bottom: anchor.bottom + 'px',
                        width: MENU_WIDTH + 'px',
                      },
                      onKeyDown: onMenuKeyDown,
                    },
                    MODES.map((entry) =>
                      h(
                        'button',
                        {
                          key: entry,
                          type: 'button',
                          role: 'menuitemradio',
                          'aria-checked': entry === mode ? 'true' : 'false',
                          'data-level': entry,
                          tabIndex: -1,
                          className: 'creativity-mode-item',
                          onClick: () => {
                            choose(entry);
                          },
                        },
                        h('span', { className: 'creativity-mode-item-icon' }, glyph(entry)),
                        h('span', { className: 'creativity-mode-item-label' }, t('level.' + entry)),
                        entry === mode
                          ? h('span', { className: 'creativity-mode-item-check' }, checkGlyph())
                          : null,
                      ),
                    ),
                  ),
                  document.body,
                )
              : null,
          );
        }

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'creativity',
              order: 23,
              locale: NS,
            },
            CreativityControl,
          ),
        );
      },
    };
  },
});
