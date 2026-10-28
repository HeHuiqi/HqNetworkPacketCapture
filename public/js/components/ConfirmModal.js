import { store, actions } from '../store.js';

export default {
  name: 'ConfirmModal',
  setup() {
    const onConfirm = () => {
      actions.closeConfirm(true);
    };

    const onCancel = () => {
      actions.closeConfirm(false);
    };

    return {
      store,
      actions,
      onConfirm,
      onCancel
    };
  },
  template: `
    <div 
      class="confirm-modal-overlay" 
      v-if="store.confirmDialog.visible" 
      @click.self="onCancel"
    >
      <div class="confirm-modal-card">
        <div class="confirm-modal-header">
          <div class="confirm-header-left">
            <span class="confirm-icon-badge" :class="store.confirmDialog.type">
              {{ store.confirmDialog.type === 'danger' ? '🗑️' : (store.confirmDialog.type === 'warning' ? '⚠️' : 'ℹ️') }}
            </span>
            <span class="confirm-modal-title">{{ store.confirmDialog.title }}</span>
          </div>
          <button class="close-btn" @click="onCancel">✕</button>
        </div>

        <div class="confirm-modal-body">
          <div class="confirm-main-message">{{ store.confirmDialog.message }}</div>
          <div v-if="store.confirmDialog.detail" class="confirm-detail-message">
            {{ store.confirmDialog.detail }}
          </div>
        </div>

        <div class="confirm-modal-footer">
          <button class="btn btn-default" @click="onCancel">
            {{ store.confirmDialog.cancelText || '取消' }}
          </button>
          <button 
            class="btn" 
            :class="store.confirmDialog.type === 'danger' ? 'btn-danger' : 'btn-primary'" 
            @click="onConfirm"
          >
            {{ store.confirmDialog.confirmText || '确定' }}
          </button>
        </div>
      </div>
    </div>
  `
};
