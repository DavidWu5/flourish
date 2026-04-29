function createDefaultApi() {
  return {
    async diagnose(payload) {
      const response = await globalThis.fetch("/api/node/diagnose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Diagnose failed: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
  };
}

function findNodeRecord(snapshot, nodeId) {
  if (!snapshot || !nodeId) return null;
  if (snapshot.root?.id === nodeId) return snapshot.root;
  return snapshot.nodes.find((node) => node.id === nodeId) || null;
}

export function setupQuestionFlow({
  controller,
  renderer,
  getApi = createDefaultApi,
} = {}) {
  const panel = document.querySelector("#questionPanel");
  const title = document.querySelector("#questionTitle");
  const path = document.querySelector("#questionNodePath");
  const prompt = document.querySelector("#questionPrompt");
  const form = document.querySelector("#questionForm");
  const answerInput = document.querySelector("#questionAnswer");
  const closeButton = document.querySelector("#questionClose");
  const resetButton = document.querySelector("#questionReset");
  const submitButton = document.querySelector("#questionSubmit");
  const status = document.querySelector("#questionStatus");

  if (
    !panel ||
    !title ||
    !path ||
    !prompt ||
    !form ||
    !answerInput ||
    !closeButton ||
    !resetButton ||
    !submitButton ||
    !status
  ) {
    throw new Error("Question panel UI is missing required DOM elements.");
  }

  let activeNode = null;
  let isSubmitting = false;
  let ignoreSelectionUpdates = false;

  function getSnapshot() {
    return controller.getSnapshot();
  }

  function getTopicLabel() {
    return getSnapshot()?.root?.label || controller.initialTopic || "Learning Tree";
  }

  function getNodeRecord(nodeId) {
    return findNodeRecord(getSnapshot(), nodeId);
  }

  function getPanelQuestion(node = activeNode) {
    return String(node?.metadata?.question || "").trim();
  }

  function setPanelStatus(message = "", tone = "info") {
    const text = String(message || "").trim();
    status.hidden = !text;
    status.textContent = text;
    status.dataset.tone = text ? tone : "";
  }

  function setSubmitting(nextSubmitting) {
    isSubmitting = nextSubmitting;
    panel.setAttribute("aria-busy", String(nextSubmitting));
    answerInput.disabled = nextSubmitting;
    submitButton.disabled = nextSubmitting;
    closeButton.disabled = nextSubmitting;
    resetButton.disabled = nextSubmitting;
    submitButton.textContent = nextSubmitting ? "Checking..." : "Check understanding";
  }

  function focusAnswer() {
    requestAnimationFrame(() => {
      answerInput.focus();
      answerInput.select();
    });
  }

  function clearAnswer() {
    answerInput.value = "";
    setPanelStatus("", "info");
  }

  function hidePanel() {
    panel.hidden = true;
    clearAnswer();
    activeNode = null;
    setSubmitting(false);
  }

  function showPanel(node) {
    activeNode = node;
    panel.hidden = false;
    title.textContent = node.label || "Question";
    path.textContent = Array.isArray(node.path) ? node.path.join(" / ") : node.label || "";
    prompt.textContent =
      getPanelQuestion(node) ||
      "This branch does not have a diagnostic question yet.";
    clearAnswer();
    setSubmitting(false);
    focusAnswer();
  }

  function getLockedMessage(node) {
    const prerequisiteId = node?.metadata?.prerequisiteNodeId;
    if (!prerequisiteId) return null;

    const prerequisiteNode = getNodeRecord(prerequisiteId);
    if (prerequisiteNode?.metadata?.status === "complete") {
      return null;
    }

    const prerequisiteLabel = prerequisiteNode?.label || "the new prerequisite branch";
    return `Something's missing — try ${prerequisiteLabel} first.`;
  }

  function openQuestion(node) {
    const question = getPanelQuestion(node);
    if (!question) {
      hidePanel();
      return;
    }

    const lockedMessage = getLockedMessage(node);
    if (lockedMessage) {
      hidePanel();
      return;
    }

    showPanel(node);
  }

  function patchNodeMetadata(nodeId, updater) {
    const snapshotNode = getNodeRecord(nodeId);
    const currentMetadata = snapshotNode?.metadata || {};
    const nextMetadata =
      typeof updater === "function" ? updater(currentMetadata, snapshotNode) : updater;

    ignoreSelectionUpdates = true;
    try {
      renderer.patchNode(nodeId, {
        metadata: nextMetadata,
      });
    } finally {
      ignoreSelectionUpdates = false;
    }
  }

  function appendPrerequisiteNode(parentNodeId, nodeData) {
    ignoreSelectionUpdates = true;
    try {
      renderer.appendChildren(parentNodeId, [nodeData]);
    } finally {
      ignoreSelectionUpdates = false;
    }
  }

  function unlockParentIfPrerequisiteComplete(nodeId) {
    const snapshotNode = getNodeRecord(nodeId);
    if (snapshotNode?.metadata?.kind !== "prerequisite") {
      return;
    }

    const parentId = snapshotNode.parentId;
    if (!parentId) return;

    const parentRecord = getNodeRecord(parentId);
    if (!parentRecord) return;

    patchNodeMetadata(parentId, (currentMetadata) => ({
      ...currentMetadata,
      status: "retry",
      prerequisiteNodeId: null,
    }));
  }

  async function submitAnswer() {
    if (!activeNode || isSubmitting) return;

    const node = activeNode;
    const question = getPanelQuestion(node);
    if (!question) {
      return;
    }

    setSubmitting(true);
    setPanelStatus("Checking understanding...", "info");

    try {
      const api = typeof getApi === "function" ? getApi() : createDefaultApi();
      const diagnosis = await api.diagnose({
        topic: getTopicLabel(),
        nodeId: node.id,
        nodeLabel: node.label,
        question,
        answer: answerInput.value,
        parentId: getNodeRecord(node.id)?.parentId || null,
        existingNodeIds: [node.id],
      });

      if (
        diagnosis.tree_action === "insert_prerequisite_node" &&
        diagnosis.new_node
      ) {
        const prerequisiteNode = {
          id: diagnosis.new_node.id || `${node.id}--prereq-${Date.now().toString(36)}`,
          label: diagnosis.new_node.title || diagnosis.missing_prerequisite || "Prerequisite",
          parentId: node.id,
          summary: diagnosis.new_node.summary || diagnosis.misconception || "",
          description:
            diagnosis.new_node.description ||
            `Prerequisite: learn this before continuing with ${node.label}.`,
          expandable: true,
          metadata: {
            kind: "prerequisite",
            question: diagnosis.new_node.question || "",
            status: "ready",
          },
        };

        patchNodeMetadata(node.id, (currentMetadata) => ({
          ...currentMetadata,
          status: "locked",
          prerequisiteNodeId: prerequisiteNode.id,
        }));
        appendPrerequisiteNode(node.id, prerequisiteNode);
        hidePanel();
        return;
      }

      if (diagnosis.understanding_level === "correct") {
        patchNodeMetadata(node.id, (currentMetadata) => ({
          ...currentMetadata,
          status: "complete",
          prerequisiteNodeId: null,
        }));
        unlockParentIfPrerequisiteComplete(node.id);
        hidePanel();
        return;
      }

      setPanelStatus(
        diagnosis.feedback_message ||
          "Not quite yet — take another swing at this branch.",
        "warning",
      );
      focusAnswer();
    } catch (error) {
      console.error("Question diagnosis failed", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Something went wrong while checking this answer.";
      setPanelStatus(message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    hidePanel();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAnswer();
  });

  closeButton.addEventListener("click", () => {
    handleClose();
  });

  resetButton.addEventListener("click", () => {
    clearAnswer();
    focusAnswer();
  });

  renderer.setNodeSelectHandler((node) => {
    if (!node || isSubmitting) return;
    if (ignoreSelectionUpdates) {
      if (activeNode?.id === node.id) {
        activeNode = node;
      }
      return;
    }
    openQuestion(node);
  });

  return {
    close: handleClose,
    openQuestion,
  };
}
