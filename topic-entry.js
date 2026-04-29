import { ApiTreeProvider } from "./tree-provider.js";

function createDefaultProvider() {
  return new ApiTreeProvider();
}

export function setupTopicEntry({
  controller,
  resetViewport = () => {},
  focusTree = () => {},
  animateTreeTopic = () => {},
  onTopicSeeded = () => {},
  createProvider = createDefaultProvider,
  defaultTopic = "",
} = {}) {
  const modal = document.querySelector("#topicModal");
  const form = document.querySelector("#topicForm");
  const input = document.querySelector("#topicInput");
  const submitButton = document.querySelector("#topicSubmit");
  const status = document.querySelector("#topicStatus");
  const chips = Array.from(document.querySelectorAll(".topic-chip"));

  if (!modal || !form || !input || !submitButton) {
    throw new Error("Topic entry UI is missing required DOM elements.");
  }

  const idleSubmitLabel = submitButton.textContent || "Grow the tree";
  let isSubmitting = false;

  function setExiting(nextExiting) {
    modal.classList.toggle("is-exiting", nextExiting);
  }

  function focusInput() {
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function setStatus(message = "", { hidden = !message } = {}) {
    if (!status) return;
    status.hidden = hidden;
    status.textContent = hidden ? "" : message;
  }

  function setBusyState(nextBusy) {
    isSubmitting = nextBusy;
    form.setAttribute("aria-busy", String(nextBusy));
    input.disabled = nextBusy;
    submitButton.disabled = nextBusy;
    chips.forEach((chip) => {
      chip.disabled = nextBusy;
    });
    submitButton.textContent = nextBusy ? "Growing..." : idleSubmitLabel;
  }

  function open() {
    modal.hidden = false;
    setExiting(false);
    if (defaultTopic && !input.value.trim()) {
      input.value = defaultTopic;
    }
    focusTree({ behavior: "auto" });
    focusInput();
  }

  function close() {
    setExiting(false);
    modal.hidden = true;
    setStatus("", { hidden: true });
  }

  async function submitTopic(rawTopic) {
    const topic = String(rawTopic ?? input.value ?? "").trim();
    if (!topic) {
      setStatus("Enter a topic to grow the learning tree.");
      focusInput();
      return false;
    }

    if (isSubmitting) {
      return false;
    }

    input.value = topic;
    setExiting(true);
    setBusyState(true);
    setStatus("Planting the root...");

    try {
      resetViewport();
      controller.setProvider(createProvider());

      await controller.seed(topic);
      onTopicSeeded(controller.getSnapshot(), topic);

      const snapshot = controller.getSnapshot();
      const rootId = snapshot?.root?.id;

      if (!rootId) {
        throw new Error("Seed response did not include a root node.");
      }

      animateTreeTopic(topic);
      setStatus("Growing the first foundational branches...");
      await controller.expand(rootId);

      close();
      focusTree({ behavior: "smooth" });
      return true;
    } catch (error) {
      console.error("Topic entry failed", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Something went wrong while growing the topic.";
      setStatus(message);
      setExiting(false);
      focusInput();
      return false;
    } finally {
      setBusyState(false);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitTopic();
  });

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const topic = chip.textContent || "";
      void submitTopic(topic);
    });
  });

  open();

  return {
    open,
    close,
    submitTopic,
  };
}
