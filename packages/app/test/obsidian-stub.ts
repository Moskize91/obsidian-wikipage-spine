export class Notice {
  constructor(readonly message: string) {}
}

export class Plugin {
  app = {};

  addCommand(_command: { id: string; name: string; callback: () => void }): void {}

  addSettingTab(_tab: PluginSettingTab): void {}

  async loadData(): Promise<unknown> {
    return null;
  }

  async saveData(_data: unknown): Promise<void> {}
}

export class PluginSettingTab {
  containerEl = {
    empty(): void {},
  };

  constructor(
    readonly app: unknown,
    readonly plugin: Plugin,
  ) {}

  display(): void {}
}

export class Setting {
  constructor(readonly containerEl: unknown) {}

  setName(_name: string): this {
    return this;
  }

  setDesc(_desc: string): this {
    return this;
  }

  addText(callback: (component: TextComponent) => void): this {
    callback(new TextComponent());
    return this;
  }

  addTextArea(callback: (component: TextComponent) => void): this {
    callback(new TextComponent());
    return this;
  }

  addDropdown(callback: (component: DropdownComponent) => void): this {
    callback(new DropdownComponent());
    return this;
  }
}

class TextComponent {
  setPlaceholder(_placeholder: string): this {
    return this;
  }

  setValue(_value: string): this {
    return this;
  }

  onChange(_callback: (value: string) => void): this {
    return this;
  }
}

class DropdownComponent {
  addOption(_value: string, _display: string): this {
    return this;
  }

  setValue(_value: string): this {
    return this;
  }

  onChange(_callback: (value: string) => void): this {
    return this;
  }
}
