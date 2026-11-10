import { ref, computed, watch, nextTick } from '/vendor/vue.esm-browser.js';

const JsonTreeNode = {
  name: 'JsonTreeNode',
  props: {
    nodeKey: {
      type: [String, Number],
      required: true
    },
    value: {
      type: [Object, Array, String, Number, Boolean, null, Symbol],
      default: null
    },
    parent: {
      type: [Object, Array, null],
      default: null
    },
    depth: {
      type: Number,
      default: 0
    },
    isReadOnly: {
      type: Boolean,
      default: false
    },
    expandSignal: {
      type: Boolean,
      default: null
    }
  },
  emits: ['change'],
  setup(props, { emit }) {
    // 默认展开深度 <= 1 的节点
    const isExpanded = ref(props.depth <= 1);
    const isEditingKey = ref(false);
    const editingKeyText = ref(String(props.nodeKey));
    const keyInputRef = ref(null);

    // 监听全局展开/折叠广播
    watch(() => props.expandSignal, (sig) => {
      if (sig !== null && sig !== undefined) {
        isExpanded.value = sig;
      }
    });

    // 计算当前节点类型
    const valueType = computed(() => {
      if (props.value === null) return 'null';
      if (Array.isArray(props.value)) return 'array';
      return typeof props.value; // 'string', 'number', 'boolean', 'object'
    });

    // 是否为容器对象或数组
    const isContainer = computed(() => {
      return valueType.value === 'object' || valueType.value === 'array';
    });

    // 子项键名列表
    const childKeys = computed(() => {
      if (valueType.value === 'array') {
        return (props.value || []).map((_, idx) => idx);
      }
      if (valueType.value === 'object' && props.value !== null) {
        return Object.keys(props.value);
      }
      return [];
    });

    // 容器内元素个数提示
    const childCountText = computed(() => {
      if (valueType.value === 'array') {
        const len = (props.value || []).length;
        return `${len} 项`;
      }
      if (valueType.value === 'object' && props.value !== null) {
        const keysLen = Object.keys(props.value).length;
        return `${keysLen} 个属性`;
      }
      return '';
    });

    // 是否允许重命名键名（只有作为普通对象的子属性时可以修改；根节点或数组项不可改）
    const canRenameKey = computed(() => {
      if (props.isReadOnly) return false;
      if (props.depth === 0) return false;
      return props.parent && typeof props.parent === 'object' && !Array.isArray(props.parent);
    });

    // 切换折叠/展开
    const toggleExpand = () => {
      if (isContainer.value) {
        isExpanded.value = !isExpanded.value;
      }
    };

    // 进入键名编辑
    const startEditKey = () => {
      if (!canRenameKey.value) return;
      isEditingKey.value = true;
      editingKeyText.value = String(props.nodeKey);
      nextTick(() => {
        if (keyInputRef.value) {
          keyInputRef.value.focus();
          keyInputRef.value.select();
        }
      });
    };

    // 确认重命名键名（保持对象原始属性顺序）
    const confirmRenameKey = () => {
      if (!isEditingKey.value) return;
      isEditingKey.value = false;
      const oldKey = String(props.nodeKey);
      const newKey = editingKeyText.value.trim();
      if (!newKey || newKey === oldKey) {
        editingKeyText.value = oldKey;
        return;
      }

      if (props.parent && typeof props.parent === 'object' && !Array.isArray(props.parent)) {
        const keys = Object.keys(props.parent);
        const entries = [];
        for (const k of keys) {
          if (k === oldKey) {
            entries.push([newKey, props.parent[oldKey]]);
          } else {
            entries.push([k, props.parent[k]]);
          }
        }
        for (const k of keys) {
          delete props.parent[k];
        }
        for (const [k, v] of entries) {
          props.parent[k] = v;
        }
        emit('change');
      }
    };

    // 字符串/数字值修改
    const onStringChange = (newVal) => {
      if (props.isReadOnly) return;
      if (props.parent) {
        props.parent[props.nodeKey] = newVal;
        emit('change');
      }
    };

    const onNumberChange = (newVal) => {
      if (props.isReadOnly) return;
      const num = newVal === '' ? 0 : Number(newVal);
      if (props.parent) {
        props.parent[props.nodeKey] = isNaN(num) ? 0 : num;
        emit('change');
      }
    };

    // 布尔值切换
    const toggleBoolean = () => {
      if (props.isReadOnly) return;
      if (props.parent) {
        props.parent[props.nodeKey] = !props.value;
        emit('change');
      }
    };

    // 切换数据类型
    const onTypeChange = (newType) => {
      if (props.isReadOnly || !props.parent) return;
      let converted;
      if (newType === 'string') {
        converted = props.value !== null && props.value !== undefined ? String(props.value) : '';
      } else if (newType === 'number') {
        converted = isNaN(Number(props.value)) ? 0 : Number(props.value);
      } else if (newType === 'boolean') {
        converted = Boolean(props.value);
      } else if (newType === 'object') {
        converted = {};
      } else if (newType === 'array') {
        converted = [];
      } else if (newType === 'null') {
        converted = null;
      }

      props.parent[props.nodeKey] = converted;
      isExpanded.value = true;
      emit('change');
    };

    // 添加子节点 (对象新增属性，或数组 push 新项)
    const addChild = () => {
      if (props.isReadOnly) return;
      if (valueType.value === 'object' && props.value !== null) {
        const keys = Object.keys(props.value);
        let baseName = 'new_field';
        let counter = 1;
        while (keys.includes(`${baseName}_${counter}`)) {
          counter++;
        }
        const newKey = `${baseName}_${counter}`;
        props.value[newKey] = '';
        isExpanded.value = true;
        emit('change');
      } else if (valueType.value === 'array') {
        props.value.push('');
        isExpanded.value = true;
        emit('change');
      }
    };

    // 删除当前节点
    const deleteNode = () => {
      if (props.isReadOnly || !props.parent) return;
      if (Array.isArray(props.parent)) {
        props.parent.splice(Number(props.nodeKey), 1);
        emit('change');
      } else if (typeof props.parent === 'object') {
        delete props.parent[props.nodeKey];
        emit('change');
      }
    };

    return {
      isExpanded,
      isEditingKey,
      editingKeyText,
      keyInputRef,
      valueType,
      isContainer,
      childKeys,
      childCountText,
      canRenameKey,
      toggleExpand,
      startEditKey,
      confirmRenameKey,
      onStringChange,
      onNumberChange,
      toggleBoolean,
      onTypeChange,
      addChild,
      deleteNode
    };
  },
  template: `
    <div class="tree-node" :class="{ 'is-root': depth === 0 }">
      <!-- 节点自身行内容 -->
      <div class="tree-node-row">
        <!-- 折叠/展开箭头 (仅容器类型) -->
        <span 
          v-if="isContainer" 
          class="tree-expander" 
          :class="{ expanded: isExpanded }" 
          @click.stop="toggleExpand"
          :title="isExpanded ? '点击折叠' : '点击展开'"
        >
          {{ isExpanded ? '▼' : '▶' }}
        </span>
        <span v-else class="tree-expander-spacer"></span>

        <!-- 键名 Key (非根节点时显示) -->
        <div v-if="depth > 0" class="tree-key-wrapper">
          <!-- 数组项索引标识 -->
          <span v-if="Array.isArray(parent)" class="tree-array-index" title="数组下标">
            [{{ nodeKey }}]
          </span>

          <!-- 对象属性名 (支持就地双击/点击修改) -->
          <template v-else>
            <input 
              v-if="isEditingKey"
              ref="keyInputRef"
              type="text" 
              class="tree-key-input"
              v-model="editingKeyText"
              @blur="confirmRenameKey"
              @keydown.enter.prevent="confirmRenameKey"
              @keydown.esc="isEditingKey = false"
            />
            <span 
              v-else 
              class="tree-key-text" 
              :class="{ 'editable': canRenameKey }" 
              @click="startEditKey"
              :title="canRenameKey ? '点击修改键名' : ''"
            >
              "{{ nodeKey }}"
            </span>
          </template>
          <span class="tree-colon">:</span>
        </div>

        <!-- 根节点标识 -->
        <span v-else class="tree-root-label">
          root
        </span>

        <!-- 节点值 Value 编辑区 -->
        <div class="tree-value-wrapper">
          <!-- 1. 容器对象/数组：显示类型括号与元素个数 -->
          <template v-if="valueType === 'object'">
            <span class="tree-bracket" @click="toggleExpand">{</span>
            <span class="tree-badge-count" @click="toggleExpand">{{ childCountText }}</span>
            <span class="tree-bracket" v-if="!isExpanded">... }</span>
          </template>

          <template v-else-if="valueType === 'array'">
            <span class="tree-bracket" @click="toggleExpand">[</span>
            <span class="tree-badge-count" @click="toggleExpand">{{ childCountText }}</span>
            <span class="tree-bracket" v-if="!isExpanded">... ]</span>
          </template>

          <!-- 2. 字符串类型 -->
          <div v-else-if="valueType === 'string'" class="tree-val-string-box">
            <span class="tree-quote">"</span>
            <input 
              type="text" 
              class="tree-val-input val-string" 
              :value="value" 
              :readonly="isReadOnly"
              @change="onStringChange($event.target.value)" 
              placeholder="(空字符串)"
            />
            <span class="tree-quote">"</span>
          </div>

          <!-- 3. 数字类型 -->
          <div v-else-if="valueType === 'number'" class="tree-val-number-box">
            <input 
              type="number" 
              class="tree-val-input val-number" 
              :value="value" 
              :readonly="isReadOnly"
              @change="onNumberChange($event.target.value)" 
            />
          </div>

          <!-- 4. 布尔类型 -->
          <button 
            v-else-if="valueType === 'boolean'" 
            class="tree-bool-btn" 
            :class="value ? 'bool-true' : 'bool-false'"
            @click="toggleBoolean"
            :disabled="isReadOnly"
            :title="'点击切换布尔值 (' + (value ? 'true' : 'false') + ')'"
          >
            {{ value ? 'true' : 'false' }}
          </button>

          <!-- 5. null 类型 -->
          <span v-else-if="valueType === 'null'" class="tree-null-tag">
            null
          </span>
        </div>

        <!-- 右侧悬浮操作工具栏 (类型切换、加子项、删除) -->
        <div class="tree-node-actions" v-if="!isReadOnly">
          <!-- 类型切换选择器 (非根节点支持改类型) -->
          <select 
            v-if="depth > 0"
            class="tree-type-select" 
            :value="valueType" 
            @change="onTypeChange($event.target.value)"
            title="更改数据类型"
          >
            <option value="string">str</option>
            <option value="number">num</option>
            <option value="boolean">bool</option>
            <option value="object">obj</option>
            <option value="array">arr</option>
            <option value="null">null</option>
          </select>

          <!-- 容器类型添加子项按钮 -->
          <button 
            v-if="isContainer" 
            class="tree-btn-action btn-add" 
            @click.stop="addChild" 
            :title="valueType === 'object' ? '新增属性' : '新增数组项'"
          >
            +
          </button>

          <!-- 非根节点删除按钮 -->
          <button 
            v-if="depth > 0" 
            class="tree-btn-action btn-del" 
            @click.stop="deleteNode" 
            title="删除此字段"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- 递归渲染子节点列表 -->
      <div v-if="isContainer && isExpanded" class="tree-children">
        <template v-if="childKeys.length > 0">
          <json-tree-node
            v-for="k in childKeys"
            :key="k"
            :node-key="k"
            :value="value[k]"
            :parent="value"
            :depth="depth + 1"
            :is-read-only="isReadOnly"
            :expand-signal="expandSignal"
            @change="$emit('change')"
          ></json-tree-node>
        </template>
        <div v-else class="tree-empty-container">
          <span class="tree-empty-text">(空{{ valueType === 'object' ? '对象' : '数组' }})</span>
          <button class="tree-btn-mini-add" @click="addChild">+ 添加{{ valueType === 'object' ? '首个属性' : '首个元素' }}</button>
        </div>

        <!-- 闭合括号 -->
        <div class="tree-closing-bracket">
          {{ valueType === 'object' ? '}' : ']' }}
        </div>
      </div>
    </div>
  `
};

JsonTreeNode.components = {
  JsonTreeNode
};

export default JsonTreeNode;
