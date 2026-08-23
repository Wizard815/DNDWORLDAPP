import { ReactRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { ComponentType, ForwardRefExoticComponent, RefAttributes } from "react";

interface ListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

/**
 * Shared `render()` factory for every `/`- and `@`/`[[`-style suggestion
 * popup in this editor. `@tiptap/suggestion` v3.30's `props.mount()` owns
 * positioning (Floating UI, auto-repositioning on scroll/resize) and
 * dismiss-on-outside-click — this only wires a React popup into that
 * lifecycle, the same shape TipTap's own docs recommend.
 */
export function createSuggestionRenderer<Item, Command = Item>(
  Component: ForwardRefExoticComponent<
    { items: Item[]; command: (value: Command) => void } & RefAttributes<ListHandle>
  >,
) {
  return () => {
    let component: ReactRenderer<ListHandle, { items: Item[]; command: (value: Command) => void }> | null = null;
    let unmount: (() => void) | undefined;

    return {
      onStart(props: SuggestionProps<Item, Command>) {
        component = new ReactRenderer(Component as ComponentType<never>, {
          props: { items: props.items, command: props.command },
          editor: props.editor,
        });
        unmount = props.mount(component.element);
      },
      onUpdate(props: SuggestionProps<Item, Command>) {
        component?.updateProps({ items: props.items, command: props.command });
      },
      onKeyDown(props: SuggestionKeyDownProps): boolean {
        if (props.event.key === "Escape") {
          unmount?.();
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit() {
        unmount?.();
        component?.destroy();
      },
    };
  };
}
