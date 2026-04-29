const STATE_CONFIG = {
  idle: {
    label: "Guide dock",
    status: "Ready to plant a new learning tree",
    defaultSpeech: "Pick a topic and I’ll help grow the first branches.",
  },
  asking: {
    label: "Question mode",
    status: "Listening for the next learning move",
    defaultSpeech: "Tell me what you want to grow.",
  },
  concerned: {
    label: "Needs attention",
    status: "Something needs another pass",
    defaultSpeech: "That branch hit a snag. Let’s steady it and try again.",
  },
  happy: {
    label: "Strong branch",
    status: "The tree is growing well",
    defaultSpeech: "Nice. This part of the tree is blooming.",
  },
};

function getStateConfig(state) {
  return STATE_CONFIG[state] || STATE_CONFIG.idle;
}

export class Mascot {
  constructor({
    root = document.querySelector("#mascotDock"),
    bubble = document.querySelector("#mascotBubble"),
    stage = document.querySelector("#mascotStage"),
    stateLabel = document.querySelector("#mascotStateLabel"),
    speech = document.querySelector("#mascotSpeech"),
    status = document.querySelector("#mascotStatus"),
  } = {}) {
    if (!root || !bubble || !stage || !stateLabel || !speech || !status) {
      throw new Error("Mascot UI is missing required DOM elements.");
    }

    this.root = root;
    this.bubble = bubble;
    this.stage = stage;
    this.stateLabel = stateLabel;
    this.speech = speech;
    this.status = status;
    this.state = "idle";
    this.clearTimer = null;

    this.setState("idle");
  }

  setState(nextState = "idle", overrides = {}) {
    const normalizedState = STATE_CONFIG[nextState] ? nextState : "idle";
    const config = getStateConfig(normalizedState);

    this.state = normalizedState;
    this.root.dataset.state = normalizedState;
    this.bubble.dataset.state = normalizedState;
    this.stage.dataset.state = normalizedState;
    this.stateLabel.textContent = overrides.label || config.label;
    this.status.textContent = overrides.status || config.status;

    if (overrides.speech) {
      this.say(overrides.speech, overrides.ms);
      return;
    }

    if (!this.speech.textContent?.trim()) {
      this.speech.textContent = config.defaultSpeech;
    }
  }

  say(message, ms) {
    this.clearPendingTimer();
    this.speech.textContent = String(message || "").trim() || getStateConfig(this.state).defaultSpeech;

    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
      this.clearTimer = window.setTimeout(() => {
        this.clear();
      }, ms);
    }
  }

  clear() {
    this.clearPendingTimer();
    this.speech.textContent = getStateConfig(this.state).defaultSpeech;
  }

  clearPendingTimer() {
    if (!this.clearTimer) return;
    window.clearTimeout(this.clearTimer);
    this.clearTimer = null;
  }
}
