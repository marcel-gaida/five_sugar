/**
 * Kitchen Vault — background.js
 * Service worker for background actions, context menus, and communication.
 */

let pendingRecipe = null;

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "popup.html" });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "send-to-kitchenvault",
    title: "Send to KitchenVault",
    contexts: ["page", "selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "send-to-kitchenvault") {
    const selection = info.selectionText || "";
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showRecipeNameModal,
      args: [selection]
    });
  }
});

function openAppAndSendRecipe(recipeData) {
    chrome.tabs.query({ url: chrome.runtime.getURL("popup.html") }, (tabs) => {
        if (tabs && tabs.length > 0) {
            // Found existing KitchenVault tab — focus it and send recipe details
            const targetTab = tabs[0];
            chrome.tabs.update(targetTab.id, { active: true });
            chrome.windows.update(targetTab.windowId, { focused: true });
            chrome.tabs.sendMessage(targetTab.id, { action: "import_recipe", ...recipeData });
        } else {
            // No tab open — queue recipe details as pending and open a new KitchenVault tab
            pendingRecipe = recipeData;
            chrome.tabs.create({ url: "popup.html" });
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "popup_ready") {
        if (pendingRecipe) {
            sendResponse({ pendingRecipe: pendingRecipe });
            pendingRecipe = null;
        } else {
            sendResponse({});
        }
    } else if (message.action === "save_recipe_details") {
        openAppAndSendRecipe({
            title: message.title,
            url: message.url,
            html: message.html
        });
    }
    return true; // Keep message channel open for async sendResponse
});

/**
 * Self-contained modal function injected into the active webpage context.
 * Renders a shadow-DOM overlay dialog asking for the recipe title.
 */
function showRecipeNameModal(selectionText) {
    if (document.getElementById('kitchenvault-modal-container')) {
        return;
    }

    const container = document.createElement('div');
    container.id = 'kitchenvault-modal-container';
    container.style.cssText = 'position:fixed; inset:0; z-index:999999; display:flex; align-items:center; justify-content:center; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;';
    
    const shadow = container.attachShadow({ mode: 'closed' });
    
    const style = document.createElement('style');
    style.textContent = `
        .overlay {
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(4px);
            transition: opacity 0.2s ease;
        }
        .modal {
            position: relative;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
            width: 380px;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            border: 1px solid #e2ebd9;
        }
        @keyframes slideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .header {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #2c5e43;
            font-weight: 700;
            font-size: 18px;
        }
        .logo-icon {
            font-size: 20px;
        }
        .title-label {
            font-size: 13px;
            color: #556b5c;
            font-weight: 600;
            margin-bottom: -8px;
        }
        .input-box {
            width: 100%;
            box-sizing: border-box;
            padding: 10px 12px;
            border: 1px solid #c9d6c7;
            border-radius: 6px;
            font-size: 14px;
            color: #2c3e35;
            background: #fafcfa;
            outline: none;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .input-box:focus {
            border-color: #2c5e43;
            box-shadow: 0 0 0 3px rgba(44, 94, 67, 0.15);
        }
        .actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 4px;
        }
        .btn {
            padding: 9px 16px;
            font-size: 14px;
            font-weight: 600;
            border-radius: 6px;
            cursor: pointer;
            border: none;
            transition: all 0.2s ease;
        }
        .btn-cancel {
            background: #f1f5f0;
            color: #556b5c;
        }
        .btn-cancel:hover {
            background: #e4ece3;
        }
        .btn-save {
            background: #2c5e43;
            color: #ffffff;
        }
        .btn-save:hover {
            background: #204531;
        }
    `;
    
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = '<span class="logo-icon">🍳</span> Send to KitchenVault';
    
    const label = document.createElement('div');
    label.className = 'title-label';
    label.textContent = 'Recipe Name';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input-box';
    input.placeholder = 'e.g. Tasty Lasagna';
    
    const prefilledValue = (selectionText || document.title || "").trim();
    input.value = prefilledValue;
    
    const actions = document.createElement('div');
    actions.className = 'actions';
    
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-cancel';
    btnCancel.textContent = 'Cancel';
    
    const btnSave = document.createElement('button');
    btnSave.className = 'btn btn-save';
    btnSave.textContent = 'Save Recipe';
    
    actions.appendChild(btnCancel);
    actions.appendChild(btnSave);
    
    modal.appendChild(header);
    modal.appendChild(label);
    modal.appendChild(input);
    modal.appendChild(actions);
    
    shadow.appendChild(style);
    shadow.appendChild(overlay);
    shadow.appendChild(modal);
    
    document.body.appendChild(container);
    
    setTimeout(() => {
        input.focus();
        input.select();
    }, 50);
    
    function cleanup() {
        container.remove();
    }
    
    function submit() {
        const val = input.value.trim();
        if (!val) {
            input.style.borderColor = '#c94a47';
            input.focus();
            return;
        }
        
        chrome.runtime.sendMessage({
            action: 'save_recipe_details',
            title: val,
            url: window.location.href,
            html: document.documentElement.outerHTML
        });
        
        cleanup();
    }
    
    btnCancel.addEventListener('click', cleanup);
    overlay.addEventListener('click', cleanup);
    btnSave.addEventListener('click', submit);
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cleanup();
        }
    });
}
