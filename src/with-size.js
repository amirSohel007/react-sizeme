/* eslint-disable react/no-multi-comp */
/* eslint-disable react/prop-types */
/* eslint-disable react/require-default-props */
/* eslint-disable react/no-find-dom-node */

import React, { Children, Component } from 'react'
import ReactDOM from 'react-dom'
import invariant from 'invariant'
import { debounce, throttle } from 'throttle-debounce'
import resizeDetector from './resize-detector'

const errMsg =
  'react-sizeme: an error occurred whilst stopping to listen to node size changes'

const defaultConfig = {
  monitorWidth: true,
  monitorHeight: false,
  refreshRate: 16,
  refreshMode: 'throttle',
  noPlaceholder: false,
  resizeDetectorStrategy: 'scroll',
}

function getDisplayName(WrappedComponent) {
  return WrappedComponent.displayName || WrappedComponent.name || 'Component'
}

/**
 * This is a utility wrapper component that will allow our higher order
 * component to get a ref handle on our wrapped components html.
 * @see https://gist.github.com/jimfb/32b587ee6177665fb4cf
 */
class ReferenceWrapper extends Component {
  static displayName = 'SizeMeReferenceWrapper'

  render() {
    return Children.only(this.props.children)
  }
}

function Placeholder({ className, style }) {
  // Lets create the props for the temp element.
  const phProps = {}

  // We will use any provided className/style or else make the temp
  // container take the full available space.
  if (!className && !style) {
    phProps.style = { width: '100%', height: '100%' }
  } else {
    if (className) {
      phProps.className = className
    }
    if (style) {
      phProps.style = style
    }
  }

  return <div {...phProps} />
}
Placeholder.displayName = 'SizeMePlaceholder'

/**
 * As we need to maintain a ref on the root node that is rendered within our
 * SizeMe component we need to wrap our entire render in a sub component.
 * Without this, we lose the DOM ref after the placeholder is removed from
 * the render and the actual component is rendered.
 * It took me forever to figure this out, so tread extra careful on this one!
 */
const renderWrapper = (WrappedComponent) => {
  function SizeMeRenderer(props) {
    const {
      explicitRef,
      className,
      style,
      size,
      disablePlaceholder,
      onSize,
      ...restProps
    } = props

    const noSizeData =
      size == null || (size.width == null && size.height == null)

    const renderPlaceholder = noSizeData && !disablePlaceholder

    const renderProps = {
      className,
      style,
    }

    if (size != null) {
      renderProps.size = size
    }

    const toRender = renderPlaceholder ? (
      <Placeholder className={className} style={style} />
    ) : (
      <WrappedComponent {...renderProps} {...restProps} />
    )

    return <ReferenceWrapper ref={explicitRef}>{toRender}</ReferenceWrapper>
  }

  SizeMeRenderer.displayName = `SizeMeRenderer(${getDisplayName(
    WrappedComponent,
  )})`

  return SizeMeRenderer
}

/**
 * :: config -> Component -> WrappedComponent
 *
 * Higher order component that allows the wrapped component to become aware
 * of it's size, by receiving it as an object within it's props.
 *
 * @param  monitorWidth
 *   Default true, whether changes in the element's width should be monitored,
 *   causing a size property to be broadcast.
 * @param  monitorHeight
 *   Default false, whether changes in the element's height should be monitored,
 *   causing a size property to be broadcast.
 *
 * @return The wrapped component.
 */
function withSize(config = defaultConfig) {
  const {
    monitorWidth = defaultConfig.monitorWidth,
    monitorHeight = defaultConfig.monitorHeight,
    refreshRate = defaultConfig.refreshRate,
    refreshMode = defaultConfig.refreshMode,
    noPlaceholder = defaultConfig.noPlaceholder,
    resizeDetectorStrategy = defaultConfig.resizeDetectorStrategy,
  } = config

  invariant(
    monitorWidth || monitorHeight,
    'You have to monitor at least one of the width or height when using "sizeMe"',
  )

  invariant(
    refreshRate >= 16,
    "It is highly recommended that you don't put your refreshRate lower than " +
      '16 as this may cause layout thrashing.',
  )

  invariant(
    refreshMode === 'throttle' || refreshMode === 'debounce',
    'The refreshMode should have a value of "throttle" or "debounce"',
  )

  const refreshDelayStrategy = refreshMode === 'throttle' ? throttle : debounce

  return function WrapComponent(WrappedComponent) {
    const SizeMeRenderWrapper = renderWrapper(WrappedComponent)

    class SizeAwareComponent extends React.Component {
      constructor(props) {
        super(props)
        this.element = React.createRef()
      }

      static displayName = `SizeMe(${getDisplayName(WrappedComponent)})`

      domEl = null

      state = {
        width: undefined,
        height: undefined,
      }

      componentDidMount() {
        this.detector = resizeDetector(resizeDetectorStrategy)
        this.determineStrategy(this.props)
        this.handleDOMNode()
      }

      componentDidUpdate() {
        this.determineStrategy(this.props)
        this.handleDOMNode()
      }

      componentWillUnmount() {
        // Change our size checker to a noop just in case we have some
        // late running events.
        this.hasSizeChanged = () => undefined
        this.checkIfSizeChanged = () => undefined
        this.uninstall()
      }

      uninstall = () => {
        if (this.domEl) {
          try {
            this.detector.uninstall(this.domEl)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(errMsg)
          }
          this.domEl = null
        }
      }

      determineStrategy = (props) => {
        if (props.onSize) {
          if (!this.callbackState) {
            this.callbackState = {
              ...this.state,
            }
          }
          this.strategy = 'callback'
        } else {
          this.strategy = 'render'
        }
      }

      strategisedSetState = (state) => {
        if (this.strategy === 'callback') {
          this.callbackState = state
          this.props.onSize(state)
        }
        this.setState(state)
      }

      strategisedGetState = () =>
        this.strategy === 'callback' ? this.callbackState : this.state

      handleDOMNode() {
        const found = this.element && ReactDOM.findDOMNode(this.element.current)

        if (!found) {
          // If we previously had a dom node then we need to ensure that
          // we remove any existing listeners to avoid memory leaks.
          this.uninstall()
          return
        }

        if (!this.domEl) {
          this.domEl = found
          this.detector.listenTo(this.domEl, this.checkIfSizeChanged)
        } else if (
          (this.domEl.isSameNode && !this.domEl.isSameNode(found)) ||
          this.domEl !== found
        ) {
          this.uninstall()
          this.domEl = found
          this.detector.listenTo(this.domEl, this.checkIfSizeChanged)
        } else {
          // Do nothing 👍
        }
      }

      refCallback = (element) => {
        this.element = element
      }

      hasSizeChanged = (current, next) => {
        const c = current
        const n = next

        return (
          (monitorWidth && c.width !== n.width) ||
          (monitorHeight && c.height !== n.height)
        )
      }

      checkIfSizeChanged = refreshDelayStrategy(refreshRate, (el) => {
        const { width, height } = el.getBoundingClientRect()

        const next = {
          width: monitorWidth ? width : null,
          height: monitorHeight ? height : null,
        }

        if (this.hasSizeChanged(this.strategisedGetState(), next)) {
          this.strategisedSetState(next)
        }
      })

      render() {
        const disablePlaceholder =
          withSize.enableSSRBehaviour ||
          withSize.noPlaceholders ||
          noPlaceholder ||
          this.strategy === 'callback'

        const size = { ...this.state }

        return (
          <SizeMeRenderWrapper
            explicitRef={this.refCallback}
            size={this.strategy === 'callback' ? null : size}
            disablePlaceholder={disablePlaceholder}
            {...this.props}
          />
        )
      }
    }

    SizeAwareComponent.WrappedComponent = WrappedComponent

    return SizeAwareComponent
  }
}

/**
 * Allow SizeMe to run within SSR environments.  This is a "global" behaviour
 * flag that should be set within the initialisation phase of your application.
 *
 * Warning: don't set this flag unless you need to as using it may cause
 * extra render cycles to happen within your components depending on the logic
 * contained within them around the usage of the `size` data.
 *
 * DEPRECATED: Please use the global noPlaceholders
 */
withSize.enableSSRBehaviour = false

/**
 * Global configuration allowing to disable placeholder rendering for all
 * sizeMe components.
 */
withSize.noPlaceholders = false

export default withSize
